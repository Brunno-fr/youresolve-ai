import { describe, expect, it } from 'vitest';
import { buildCaseTimeline, buildDailyAlerts, buildOrderHistogram, datasetDateRange } from '../src/domain/analytics';
import type { AuditEvent, DataBundle, InvestigationCase } from '../src/domain/types';

const bundle: DataBundle = {
  source: 'upload',
  orders: [{ id: 'A', date: '2024-02-28', grossCents: 1000, status: 'approved', creatorId: 'C', commissionRateBps: 1000 }],
  ledger: [{ id: 'P', orderId: 'A', kind: 'payment', amountCents: 1000, at: '2024-03-02' }],
};
const occurrence: InvestigationCase = {
  id: 'CASE-A', orderId: 'A', type: 'COMMISSION_MISMATCH', severity: 'warning', status: 'resolved',
  summary: 'Diferença de comissão', evidence: [], suggestedActions: [], createdAt: '2024-02-28', amountAtRiskCents: 100,
};
const event = (id: string, action: string, at: string): AuditEvent => ({ id, action, at, caseId: occurrence.id, actor: 'Analista' });

describe('analytics temporais', () => {
  it('usa as datas importadas e inclui o dia bissexto, sem assumir novembro de 2026', () => {
    expect(datasetDateRange(bundle)).toEqual({ start: '2024-02-28', end: '2024-03-02' });
    expect(buildDailyAlerts(bundle, [occurrence])).toEqual([
      { date: '2024-02-28', count: 1 }, { date: '2024-02-29', count: 0 },
      { date: '2024-03-01', count: 0 }, { date: '2024-03-02', count: 0 },
    ]);
  });

  it('registra resolução na data do evento e reabertura apenas a partir da transição', () => {
    const audit = [event('2', 'Ocorrência reaberta', '2024-03-02T10:00:00Z'), event('1', 'Ocorrência resolvida', '2024-03-01T23:59:59Z')];
    const rows = buildCaseTimeline(bundle, [occurrence], audit, 7);
    expect(rows.find(row => row.date === '2024-02-28')).toMatchObject({ opened: 1, resolved: 0 });
    expect(rows.find(row => row.date === '2024-03-01')).toMatchObject({ opened: 1, resolved: 1 });
    expect(rows.at(-1)).toMatchObject({ date: '2024-03-02', opened: 1, resolved: 0 });
  });

  it('prefere status estruturado e inclui eventos posteriores aos registros', () => {
    const audit = [{ ...event('1', 'Decisão registrada', '2025-01-03T10:00:00Z'), status: 'resolved' as const }];
    const rows = buildCaseTimeline(bundle, [occurrence], audit, 30);
    expect(rows).toHaveLength(30);
    expect(rows.at(-2)?.resolved).toBe(0);
    expect(rows.at(-1)).toEqual({ date: '2025-01-03', opened: 1, resolved: 1 });
  });

  it('não inventa a data de resolução a partir do status atual', () => {
    const rows = buildCaseTimeline(bundle, [occurrence], [], 90);
    expect(rows).toHaveLength(90);
    expect(rows.every(row => row.resolved === 0)).toBe(true);
  });

  it('ignora eventos de outro conjunto e datas inválidas', () => {
    const audit = [{ ...event('1', 'Ocorrência resolvida', '2099-01-01T00:00:00Z'), caseId: 'OUTRO' }, event('2', 'Ocorrência resolvida', 'inválida')];
    expect(buildCaseTimeline(bundle, [occurrence], audit, 7).at(-1)?.date).toBe('2024-03-02');
  });

  it('mantém a ordem de duas transições no mesmo instante do histórico mais recente primeiro', () => {
    const at = '2024-03-02T10:00:00Z';
    const audit = [event('2', 'Ocorrência reaberta', at), event('1', 'Ocorrência resolvida', at)];
    expect(buildCaseTimeline(bundle, [occurrence], audit, 7).at(-1)?.resolved).toBe(0);
  });

  it('não gera datas ou barras fictícias para um conjunto vazio', () => {
    const empty: DataBundle = { orders: [], ledger: [], source: 'upload' };
    expect(datasetDateRange(empty)).toBeNull();
    expect(buildDailyAlerts(empty, [])).toEqual([]);
    expect(buildCaseTimeline(empty, [], [], 7)).toEqual([]);
  });

  it('limita o resumo diário a 30 barras em intervalos longos', () => {
    const extended = { ...bundle, ledger: [{ ...bundle.ledger[0], at: '2025-12-31' }] };
    const rows = buildDailyAlerts(extended, [occurrence]);
    expect(rows).toHaveLength(30);
    expect(rows[0].date).toBe('2025-12-02');
    expect(rows.at(-1)?.date).toBe('2025-12-31');
  });
});
describe('histograma de processamento', () => {
  it('conserva todos os pedidos e limita barras em importações com datas muito distantes', () => {
    const extended: DataBundle = { ...bundle, orders: [bundle.orders[0], { ...bundle.orders[0], id: 'B', date: '2030-12-31' }, { ...bundle.orders[0], id: 'C', date: '2024-02-28' }] };
    const rows = buildOrderHistogram(extended);
    expect(rows.length).toBeLessThanOrEqual(30);
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(3);
    expect(rows[0]).toMatchObject({ start: '2024-02-28', count: 2 });
    expect(rows.at(-1)).toMatchObject({ end: '2030-12-31', count: 1 });
  });

  it('agrupa pedidos da mesma data e não cria barras para conjunto vazio', () => {
    expect(buildOrderHistogram(bundle)).toEqual([{ start: '2024-02-28', end: '2024-02-28', count: 1 }]);
    expect(buildOrderHistogram({ ...bundle, orders: [] })).toEqual([]);
  });
});