import type { AuditEvent, CaseStatus, DataBundle, InvestigationCase } from './types';

const DAY_MS = 86_400_000;
export interface DailyAlerts { date: string; count: number }
export interface CaseTimelinePoint { date: string; opened: number; resolved: number }

function dateKey(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

/**
 * Obtém os extremos das datas presentes no conjunto, em dias UTC.
 * @param bundle Pedidos e lançamentos já validados pelo importador.
 * @returns Intervalo ISO ou null quando não existem registros datados.
 */
export function datasetDateRange(bundle: DataBundle): { start: string; end: string } | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const item of [...bundle.orders.map(order => order.date), ...bundle.ledger.map(entry => entry.at)]) {
    const date = dateKey(item);
    if (!date) continue;
    if (!start || date < start) start = date;
    if (!end || date > end) end = date;
  }
  return start && end ? { start, end } : null;
}

/**
 * Agrega alertas nos últimos 30 dias disponíveis, incluindo dias sem ocorrências.
 * @param bundle Conjunto carregado; não usa a data do relógio nem um mês fixo.
 * @param cases Ocorrências determinísticas do mesmo conjunto.
 * @returns Até 30 contagens diárias, limitadas ao intervalo dos registros.
 */
export function buildDailyAlerts(bundle: DataBundle, cases: InvestigationCase[]): DailyAlerts[] {
  const period = datasetDateRange(bundle);
  if (!period) return [];
  const end = Date.parse(period.end);
  const start = Math.max(Date.parse(period.start), end - 29 * DAY_MS);
  const counts = new Map<string, number>();
  for (const item of cases) counts.set(item.createdAt, (counts.get(item.createdAt) ?? 0) + 1);
  return Array.from({ length: Math.round((end - start) / DAY_MS) + 1 }, (_, index) => {
    const date = new Date(start + index * DAY_MS).toISOString().slice(0, 10);
    return { date, count: counts.get(date) ?? 0 };
  });
}

function transitionStatus(event: AuditEvent): CaseStatus | null {
  // Compatibilidade com o histórico v1, anterior ao campo de status estruturado.
  if (event.status === 'open' || event.status === 'in_review' || event.status === 'resolved') return event.status;
  if (event.action === 'Ocorrência resolvida') return 'resolved';
  if (event.action === 'Investigação iniciada') return 'in_review';
  if (event.action === 'Ocorrência reaberta') return 'open';
  return null;
}

/**
 * Reconstitui o estado das ocorrências ao final de cada dia UTC.
 * @param bundle Registros que definem o período de referência quando não há auditoria.
 * @param cases Ocorrências do conjunto atual, com datas de detecção.
 * @param audit Transições humanas datadas; eventos de outros conjuntos são ignorados.
 * @param range Janela de 7, 30 ou 90 dias terminando no último registro/evento.
 * @returns Detecções acumuladas e quantidade resolvida em cada data.
 * @remarks Reabrir um caso reduz a curva a partir do evento. Um status atual sem
 * histórico não permite inferir a data da resolução e não é retrodatado.
 */
export function buildCaseTimeline(
  bundle: DataBundle,
  cases: InvestigationCase[],
  audit: AuditEvent[],
  range: 7 | 30 | 90,
): CaseTimelinePoint[] {
  const byId = new Map(cases.map(item => [item.id, item]));
  const events = [...audit].reverse()
    .filter(event => byId.has(event.caseId) && dateKey(event.at) && transitionStatus(event))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const dates = [datasetDateRange(bundle)?.end, ...cases.map(item => dateKey(item.createdAt)), ...events.map(event => dateKey(event.at))]
    .filter((date): date is string => Boolean(date));
  if (!dates.length) return [];
  const endDate = dates.reduce((latest, date) => date > latest ? date : latest);
  const end = Date.parse(endDate);
  const resolved = new Set<string>();
  let eventIndex = 0;
  return Array.from({ length: range }, (_, index) => {
    const date = new Date(end - (range - index - 1) * DAY_MS).toISOString().slice(0, 10);
    while (eventIndex < events.length && dateKey(events[eventIndex].at)! <= date) {
      const event = events[eventIndex++];
      if (transitionStatus(event) === 'resolved') resolved.add(event.caseId);
      else resolved.delete(event.caseId);
    }
    return {
      date,
      opened: cases.filter(item => item.createdAt <= date).length,
      resolved: [...resolved].filter(id => byId.get(id)!.createdAt <= date).length,
    };
  });
}
/**
 * Agrupa todos os pedidos em até 30 intervalos diários de mesma duração.
 * @param bundle Pedidos já validados; cada pedido contribui exatamente uma vez.
 * @returns Intervalos ISO com contagens, evitando milhares de barras ilegíveis.
 */
export function buildOrderHistogram(bundle: DataBundle): { start: string; end: string; count: number }[] {
  const dates = bundle.orders.map(order => order.date).sort();
  if (!dates.length) return [];
  const start = Date.parse(dates[0]);
  const end = Date.parse(dates[dates.length - 1]);
  const totalDays = Math.round((end - start) / DAY_MS) + 1;
  const bucketDays = Math.ceil(totalDays / 30);
  const buckets = Array.from({ length: Math.ceil(totalDays / bucketDays) }, (_, index) => ({
    start: new Date(start + index * bucketDays * DAY_MS).toISOString().slice(0, 10),
    end: new Date(Math.min(end, start + ((index + 1) * bucketDays - 1) * DAY_MS)).toISOString().slice(0, 10),
    count: 0,
  }));
  for (const date of dates) buckets[Math.floor((Date.parse(date) - start) / DAY_MS / bucketDays)].count++;
  return buckets;
}