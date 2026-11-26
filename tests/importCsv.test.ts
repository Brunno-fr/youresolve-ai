import { describe, expect, it } from 'vitest';
import { parseCsv, parseImportedData, reconcile, sampleLedgerCsv, sampleOrdersCsv } from '../src/domain/reconciliation';

const ORDER_HEADER = 'id,date,grossCents,status,creatorId,commissionRateBps';
const LEDGER_HEADER = 'id,orderId,kind,amountCents,at';
const ORDER = 'ORDER-1,2026-11-20,20000,approved,CREATOR-1,2000';
const PAYMENT = 'PAY-1,ORDER-1,payment,20000,2026-11-20';
const ordersCsv = (...rows: string[]) => [ORDER_HEADER, ...rows].join('\n');
const ledgerCsv = (...rows: string[]) => [LEDGER_HEADER, ...rows].join('\n');

describe('parser CSV estrito', () => {
  it('lê BOM, aspas duplicadas, vírgulas, multiline e CRLF sem perder texto', () => {
    expect(parseCsv('\uFEFFid,name\r\n1,"Nome, com ""aspas"""\r\n2,"Duas\r\nlinhas"\r\n')).toEqual([
      ['id', 'name'], ['1', 'Nome, com "aspas"'], ['2', 'Duas\r\nlinhas'],
    ]);
  });

  it('aceita LF e CR como separadores de registro', () => {
    expect(parseCsv('id,name\r1,Um\n2,Dois')).toEqual([['id', 'name'], ['1', 'Um'], ['2', 'Dois']]);
  });

  it('ignora somente linhas vazias e preserva registros delimitados vazios', () => {
    expect(parseCsv('\n  \r\n,,\n""\n')).toEqual([['', '', ''], ['']]);
  });

  it.each(['"ab"cd,1', 'ab"cd,1', '"campo sem fim', '"a" ,1', '"a""'])('recusa aspas malformadas: %s', text => {
    expect(() => parseCsv(text)).toThrow(/aspas/);
  });

  it('recusa NUL em conteúdo textual', () => {
    expect(() => parseCsv('id,name\n1,ab\0cd')).toThrow(/NUL/);
  });

  it('preserva conteúdo semelhante a fórmulas como texto sem executá-lo', () => {
    expect(parseCsv('id,note\n1,"=HYPERLINK(""https://example.invalid"",""texto"")"')).toEqual([
      ['id', 'note'], ['1', '=HYPERLINK("https://example.invalid","texto")'],
    ]);
  });
});

describe('validação dos CSVs importados', () => {
  it('aceita amostras com BOM e CRLF, mantendo a origem local', () => {
    const bundle = parseImportedData('\uFEFF' + sampleOrdersCsv.replaceAll('\n', '\r\n'), sampleLedgerCsv);
    expect(bundle.source).toBe('upload');
    expect(bundle.orders).toHaveLength(2);
    expect(bundle.ledger).toHaveLength(5);
  });

  it('aceita lançamentos apenas com cabeçalho para investigar pagamentos ausentes', () => {
    const bundle = parseImportedData(ordersCsv(ORDER), ledgerCsv());
    expect(bundle.ledger).toEqual([]);
    expect(reconcile(bundle).cases.some(c => c.type === 'MISSING_PAYMENT')).toBe(true);
  });

  it('exige pelo menos um pedido e cabeçalho para ambos os arquivos', () => {
    expect(() => parseImportedData(ordersCsv(), ledgerCsv())).toThrow(/ao menos um registro/);
    expect(() => parseImportedData(ordersCsv(ORDER), '')).toThrow(/cabeçalho/);
  });

  it.each([
    'date,id,grossCents,status,creatorId,commissionRateBps',
    ORDER_HEADER + ',extra',
    ORDER_HEADER.replace(',creatorId', ''),
  ])('recusa cabeçalho divergente: %s', header => {
    expect(() => parseImportedData(header + '\n' + ORDER, ledgerCsv(PAYMENT))).toThrow(/Cabeçalho esperado/);
  });

  it.each([ORDER + ',extra', ORDER.substring(0, ORDER.lastIndexOf(',')), ',,,,,'])('recusa registro incompleto ou com colunas extras', row => {
    expect(() => parseImportedData(ordersCsv(row), ledgerCsv(PAYMENT))).toThrow();
  });

  it.each(['-1', '1.5', '1e3', '+1', 'NaN', 'Infinity', '', '9007199254740992'])('recusa valor monetário inválido: %s', amount => {
    expect(() => parseImportedData(ordersCsv(ORDER.replace('20000', amount)), ledgerCsv(PAYMENT))).toThrow();
    expect(() => parseImportedData(ordersCsv(ORDER), ledgerCsv(PAYMENT.replace('20000', amount)))).toThrow();
  });

  it.each(['2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-11-00', '0000-01-01', '1900-02-29', '2026-1-01'])('recusa data civil inexistente: %s', date => {
    expect(() => parseImportedData(ordersCsv(ORDER.replace('2026-11-20', date)), ledgerCsv(PAYMENT))).toThrow(/data inválida/);
    expect(() => parseImportedData(ordersCsv(ORDER), ledgerCsv(PAYMENT.replace('2026-11-20', date)))).toThrow(/data inválida/);
  });

  it.each(['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31'])('aceita data civil válida: %s', date => {
    expect(parseImportedData(ordersCsv(ORDER.replace('2026-11-20', date)), ledgerCsv(PAYMENT)).orders[0].date).toBe(date);
  });

  it('recusa IDs duplicados após remover espaços nas bordas', () => {
    expect(() => parseImportedData(ordersCsv(ORDER, ' ' + ORDER), ledgerCsv(PAYMENT))).toThrow(/pedidos possui IDs duplicados/);
    expect(() => parseImportedData(ordersCsv(ORDER), ledgerCsv(PAYMENT, PAYMENT))).toThrow(/lançamentos possui IDs duplicados/);
  });

  it('exige IDs de creator e recusa caracteres de controle nos identificadores', () => {
    expect(() => parseImportedData(ordersCsv(ORDER.replace('CREATOR-1', '')), ledgerCsv(PAYMENT))).toThrow(/creatorId/);
    expect(() => parseImportedData(ordersCsv(ORDER.replace('CREATOR-1', '"CREATOR\n1"')), ledgerCsv(PAYMENT))).toThrow(/controle/);
  });

  it('aceita vírgulas e aspas em identificadores textuais delimitados', () => {
    const bundle = parseImportedData(ordersCsv(ORDER.replace('CREATOR-1', '"Creator, ""Um"""')), ledgerCsv(PAYMENT));
    expect(bundle.orders[0].creatorId).toBe('Creator, "Um"');
  });

  it('recusa lançamento de pedido ausente em vez de descartá-lo silenciosamente', () => {
    expect(() => parseImportedData(ordersCsv(ORDER), ledgerCsv(PAYMENT.replace('ORDER-1', 'OUTRO')))).toThrow(/não existe no CSV de pedidos/);
  });

  it('recusa status, tipo e taxa fora do contrato', () => {
    expect(() => parseImportedData(ordersCsv(ORDER.replace('approved', 'pending')), ledgerCsv(PAYMENT))).toThrow(/status inválido/);
    expect(() => parseImportedData(ordersCsv(ORDER), ledgerCsv(PAYMENT.replace('payment', 'transfer')))).toThrow(/tipo inválido/);
    expect(() => parseImportedData(ordersCsv(ORDER.replace(/,2000$/, ',10001')), ledgerCsv(PAYMENT))).toThrow(/superior a 100%/);
  });

  it('recusa soma não representável antes de publicar o conjunto no estado da aplicação', () => {
    const huge = PAYMENT.replace('20000', String(Number.MAX_SAFE_INTEGER));
    const extra = PAYMENT.replace('PAY-1', 'PAY-2').replace('20000', '1');
    expect(() => parseImportedData(ordersCsv(ORDER), ledgerCsv(huge, extra))).toThrow(/soma.*limite seguro/);
  });

  it('impõe 1 MiB em bytes UTF-8 inclusive em chamadas sem a interface de upload', () => {
    const oversized = ordersCsv(ORDER.replace('CREATOR-1', 'é'.repeat(524_288)));
    expect(oversized.length).toBeLessThan(1024 * 1024);
    expect(() => parseImportedData(oversized, ledgerCsv(PAYMENT))).toThrow(/1 MiB/);
    expect(() => parseImportedData(ordersCsv(ORDER), ledgerCsv(PAYMENT) + 'x'.repeat(1024 * 1024))).toThrow(/1 MiB/);
  });

  it('aceita 10.000 pedidos e recusa o registro seguinte', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ORDER.replace('ORDER-1', 'ORDER-' + i));
    expect(parseImportedData(ordersCsv(...rows), ledgerCsv()).orders).toHaveLength(10_000);
    expect(() => parseImportedData(ordersCsv(...rows, ORDER.replace('ORDER-1', 'EXTRA')), ledgerCsv())).toThrow(/10.000 registros/);
  });

  it('aplica o mesmo limite de registros ao CSV de lançamentos', () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => PAYMENT.replace('PAY-1', 'PAY-' + i));
    expect(() => parseImportedData(ordersCsv(ORDER), ledgerCsv(...rows))).toThrow(/10.000 registros/);
  });
});
