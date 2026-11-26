import type { DataBundle, InvestigationCase, LedgerEntry, Order, ReconciliationSummary } from './types';

const MAX_CSV_BYTES = 1024 * 1024;
const MAX_RECORDS = 10_000;

/** Datas civis gregorianas reais, sem normalização automática de dias inexistentes. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

/** IDs aceitam texto e vírgulas entre aspas, mas nunca valores vazios ou controles. */
function validateIdentifier(value: string, label: string): void {
  if (!value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(label + ' precisa ser preenchido e não pode conter caracteres de controle.');
  }
}

/** Evita que inteiros inválidos cheguem a cálculos financeiros, inclusive por chamadas diretas. */
function validateInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(label + ' precisa ser um inteiro não negativo dentro do limite seguro.');
  }
}

/** Soma em centavos sem arredondar silenciosamente valores acima de MAX_SAFE_INTEGER. */
function addCents(total: number, amount: number, label: string): number {
  if (amount > Number.MAX_SAFE_INTEGER - total) {
    throw new Error(label + ': soma em centavos ultrapassa o limite seguro.');
  }
  return total + amount;
}

/**
 * Verifica o contrato também em chamadas diretas ao motor, antes de produzir qualquer caso.
 * Totais são limitados por pedido e tipo; pagamentos e reembolsos não são compensados aqui.
 */
function validateBundle(bundle: DataBundle): void {
  const orderIds = new Set<string>();
  for (const order of bundle.orders) {
    validateIdentifier(order.id, 'ID do pedido');
    validateIdentifier(order.creatorId, 'creatorId do pedido ' + order.id);
    if (orderIds.has(order.id)) throw new Error('CSV de pedidos possui IDs duplicados.');
    orderIds.add(order.id);
    if (!isCalendarDate(order.date)) throw new Error('Pedido ' + order.id + ': data inválida.');
    if (order.status !== 'approved' && order.status !== 'refunded') {
      throw new Error('Pedido ' + order.id + ': status inválido.');
    }
    validateInteger(order.grossCents, 'grossCents do pedido ' + order.id);
    validateInteger(order.commissionRateBps, 'commissionRateBps do pedido ' + order.id);
    if (order.commissionRateBps > 10_000) throw new Error('Taxa de comissão superior a 100%.');
  }
  const entryIds = new Set<string>();
  const totals = new Map<string, number>();
  for (const entry of bundle.ledger) {
    validateIdentifier(entry.id, 'ID do lançamento');
    validateIdentifier(entry.orderId, 'orderId do lançamento ' + entry.id);
    if (entryIds.has(entry.id)) throw new Error('CSV de lançamentos possui IDs duplicados.');
    entryIds.add(entry.id);
    if (!orderIds.has(entry.orderId)) {
      throw new Error('Lançamento ' + entry.id + ': pedido ' + entry.orderId + ' não existe no CSV de pedidos.');
    }
    if (!isCalendarDate(entry.at)) throw new Error('Lançamento ' + entry.id + ': data inválida.');
    if (!['payment', 'commission', 'refund'].includes(entry.kind)) {
      throw new Error('Lançamento ' + entry.id + ': tipo inválido.');
    }
    validateInteger(entry.amountCents, 'amountCents do lançamento ' + entry.id);
    const key = entry.orderId + '\0' + entry.kind;
    totals.set(key, addCents(totals.get(key) ?? 0, entry.amountCents, 'Pedido ' + entry.orderId));
  }
}

/**
 * Calcula comissão com produto inteiro exato e arredondamento de meio centavo para cima.
 * O uso transitório de bigint evita perda de precisão no produto antes da divisão em bps.
 */
function commissionInCents(grossCents: number, rateBps: number): number {
  return Number((BigInt(grossCents) * BigInt(rateBps) + 5_000n) / 10_000n);
}


/**
 * Compara pedidos e lançamentos por quatro regras determinísticas e auditáveis.
 * @param bundle Registros em centavos inteiros e taxas em pontos-base (0..10000).
 * @returns Contagens de pedidos, alertas explicáveis e percentual de pedidos sem alerta.
 * @throws Quando IDs, vínculos, datas, valores ou somas violam o contrato de entrada.
 * @remarks Não compara o valor do pagamento com o pedido nem políticas de estorno parciais.
 *
 * Importante: um alerta NÃO comprova fraude ou débito; exige investigação humana.
 * A IA generativa não participa de cálculos, aprovações ou transferências.
 */
export function reconcile(bundle: DataBundle): ReconciliationSummary {
  validateBundle(bundle);
  const byOrder = new Map<string, LedgerEntry[]>();
  for (const entry of bundle.ledger) {
    const entries = byOrder.get(entry.orderId) ?? [];
    entries.push(entry);
    byOrder.set(entry.orderId, entries);
  }
  const cases: InvestigationCase[] = [];
  let clean = 0;
  for (const order of bundle.orders) {
    const entries = byOrder.get(order.id) ?? [];
    const payments = entries.filter((e) => e.kind === 'payment');
    const commissions = entries.filter((e) => e.kind === 'commission');
    const expectedCents = commissionInCents(order.grossCents, order.commissionRateBps);
    const commissionCents = commissions.reduce((sum, e) => addCents(sum, e.amountCents, 'Comissão do pedido ' + order.id), 0);
    let alerted = false;
    const add = (
      type: InvestigationCase['type'], severity: InvestigationCase['severity'],
      summary: string, evidence: string[], suggestedActions: string[], amountAtRiskCents: number,
    ) => {
      alerted = true;
      cases.push({
        id: `${order.id}-${type}`, orderId: order.id, type, severity, status: 'open', summary,
        evidence, suggestedActions, amountAtRiskCents,
        createdAt: order.date,
      });
    };
    if (payments.length === 0) {
      add('MISSING_PAYMENT', 'critical', 'Venda sem lançamento de pagamento correspondente',
        [`Pedido ${order.id} consta como ${order.status}.`, 'Nenhum lançamento do tipo payment foi encontrado.'],
        ['Verificar identificadores e atraso na integração.', 'Conferir o registro do provedor de pagamento.'], order.grossCents);
    }
    if (payments.length > 1) {
      add('DUPLICATE_PAYMENT', 'critical', 'Mais de um lançamento de pagamento para o mesmo pedido',
        [`Pedido ${order.id} possui ${payments.length} lançamentos payment.`, `IDs: ${payments.map((p) => p.id).join(', ')}.`],
        ['Confirmar se houve captura duplicada ou somente evento repetido.', 'Validar idempotência e conciliar com o adquirente.'], order.grossCents);
    }
    if (order.status === 'approved' && commissionCents !== expectedCents) {
      add('COMMISSION_MISMATCH', 'warning', 'Comissão registrada difere da taxa contratada no cenário',
        [`Comissão esperada: ${expectedCents} centavos.`, `Comissão registrada: ${commissionCents} centavos.`, `Taxa contratada: ${order.commissionRateBps} bps.`],
        ['Conferir regras contratuais e base de cálculo.', 'Verificar reprocessamentos e possíveis ajustes.'], Math.abs(expectedCents - commissionCents));
    }
    if (order.status === 'refunded' && commissionCents > 0) {
      add('REFUND_WITH_ACTIVE_COMMISSION', 'warning', 'Reembolso com lançamento positivo de comissão',
        [`Pedido ${order.id} está reembolsado.`, `Há comissão positiva de ${commissionCents} centavos.`],
        ['Verificar a política de comissão e eventual janela de compensação.', 'Confirmar se o evento de estorno ainda será processado.'], commissionCents);
    }
    if (!alerted) clean += 1;
  }
  return { examined: bundle.orders.length, clean, cases, rate: bundle.orders.length ? (clean / bundle.orders.length) * 100 : 0 };
}

/** Converte somente a notação decimal inteira; rejeita sinais, expoentes e frações. */
function nonNegativeInt(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(label + ' precisa ser um inteiro não negativo.');
  const n = Number(value);
  validateInteger(n, label);
  return n;
}

/**
 * Lê CSV separado por vírgulas com BOM opcional, CRLF/LF/CR e aspas duplicadas.
 * @param text Conteúdo textual; vírgulas e quebras de linha exigem aspas no campo.
 * @returns Linhas e células preservadas, sem interpretar fórmulas ou remover espaços.
 * @throws Quando há aspas malformadas, caracteres após aspas de fechamento ou NUL.
 * @remarks Linhas físicas vazias são ignoradas; linhas delimitadas vazias são registros.
 */
export function parseCsv(text: string): string[][] {
  if (text.includes('\0')) throw new Error('CSV contém caractere NUL inválido.');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let state: 'start' | 'unquoted' | 'quoted' | 'closed' = 'start';
  let explicitRecord = false;
  const raw = text.replace(/^\uFEFF/, '');
  const finishRow = () => {
    row.push(cell);
    if (explicitRecord || row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
    cell = '';
    state = 'start';
    explicitRecord = false;
  };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (state === 'quoted') {
      if (ch === '"') {
        if (raw[i + 1] === '"') { cell += '"'; i++; }
        else state = 'closed';
      } else cell += ch;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      state = 'start';
      explicitRecord = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && raw[i + 1] === '\n') i++;
      finishRow();
    } else if (state === 'closed') {
      throw new Error('CSV contém conteúdo após aspas de fechamento.');
    } else if (ch === '"') {
      if (state !== 'start') throw new Error('CSV contém aspas fora de campo delimitado.');
      state = 'quoted';
      explicitRecord = true;
    } else {
      cell += ch;
      state = 'unquoted';
    }
  }
  if (state === 'quoted') throw new Error('CSV possui campo com aspas não fechado.');
  finishRow();
  return rows;
}

/**
 * Importa e valida dois CSVs inteiramente em memória, sem acesso à rede ou persistência.
 * @param ordersCsv Pedidos em UTF-8: pelo menos um registro, valores em centavos e taxas em bps.
 * @param ledgerCsv Lançamentos associados; somente cabeçalho permite investigar pagamentos ausentes.
 * @returns Conjunto validado com origem "upload", pronto para o motor de conciliação.
 * @throws Para formato inválido, datas inexistentes, IDs repetidos/órfãos, estouro de inteiros
 * ou mais de 1 MiB de UTF-8/10.000 registros por arquivo.
 * @remarks IDs e células são aparados nas bordas; fórmulas importadas permanecem texto.
 */
export function parseImportedData(ordersCsv: string, ledgerCsv: string): DataBundle {
  const extract = (csv: string, expected: string[], requireRecord: boolean) => {
    if (new TextEncoder().encode(csv).byteLength > MAX_CSV_BYTES) {
      throw new Error('Cada CSV deve ter no máximo 1 MiB (1.048.576 bytes).');
    }
    const rows = parseCsv(csv);
    if (!rows.length) throw new Error('O CSV precisa conter cabeçalho.');
    const header = rows[0].map((value) => value.trim());
    if (expected.some((name, i) => name !== header[i]) || header.length !== expected.length) {
      throw new Error('Cabeçalho esperado: ' + expected.join(','));
    }
    if (requireRecord && rows.length < 2) throw new Error('O CSV de pedidos precisa conter ao menos um registro.');
    if (rows.length > MAX_RECORDS + 1) throw new Error('Limite de 10.000 registros excedido.');
    return rows.slice(1).map((cells, index) => {
      if (cells.length !== expected.length) {
        throw new Error('Registro ' + (index + 2) + ': quantidade de colunas inválida.');
      }
      return cells.map((value) => value.trim());
    });
  };
  const orders: Order[] = extract(
    ordersCsv, ['id', 'date', 'grossCents', 'status', 'creatorId', 'commissionRateBps'], true,
  ).map(([id, date, gross, status, creatorId, rate]) => ({
    id, date, grossCents: nonNegativeInt(gross, 'grossCents'), status: status as Order['status'],
    creatorId, commissionRateBps: nonNegativeInt(rate, 'commissionRateBps'),
  }));
  const ledger: LedgerEntry[] = extract(
    ledgerCsv, ['id', 'orderId', 'kind', 'amountCents', 'at'], false,
  ).map(([id, orderId, kind, amount, at]) => ({
    id, orderId, kind: kind as LedgerEntry['kind'], amountCents: nonNegativeInt(amount, 'amountCents'), at,
  }));
  const bundle: DataBundle = { orders, ledger, source: 'upload' };
  validateBundle(bundle);
  return bundle;
}

/** CSV mínimo sem dados pessoais para reproduzir uma anomalia de demonstração. */
export const sampleOrdersCsv = 'id,date,grossCents,status,creatorId,commissionRateBps\nYS-DEMO-01,2026-11-20,20000,refunded,CREATOR-01,2000\nYS-DEMO-02,2026-11-20,30000,approved,CREATOR-02,1500';
export const sampleLedgerCsv = 'id,orderId,kind,amountCents,at\nL-01,YS-DEMO-01,payment,20000,2026-11-20\nL-02,YS-DEMO-01,commission,4000,2026-11-20\nL-03,YS-DEMO-01,refund,20000,2026-11-21\nL-04,YS-DEMO-02,payment,30000,2026-11-20\nL-05,YS-DEMO-02,commission,4500,2026-11-20';
