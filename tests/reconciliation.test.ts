import { describe, expect, it } from 'vitest';
import { buildDemoData } from '../src/domain/fixtures';
import { parseImportedData, reconcile, sampleLedgerCsv, sampleOrdersCsv } from '../src/domain/reconciliation';
import type { DataBundle } from '../src/domain/types';

function validBundle(grossCents = 20_000, commissionRateBps = 2000, commissionCents = 4000): DataBundle {
  return {
    source: 'upload',
    orders: [{ id: 'ORDER-1', date: '2026-11-20', grossCents, commissionRateBps, creatorId: 'CREATOR-1', status: 'approved' }],
    ledger: [
      { id: 'P-1', orderId: 'ORDER-1', kind: 'payment', amountCents: grossCents, at: '2026-11-20' },
      { id: 'C-1', orderId: 'ORDER-1', kind: 'commission', amountCents: commissionCents, at: '2026-11-20' },
    ],
  };
}

describe('motor de conciliação', () => {
  it('preserva a base de 1.285 pedidos, 1.248 sem alerta e as quatro categorias', () => {
    const result = reconcile(buildDemoData());
    expect(result.examined).toBe(1285);
    expect(result.clean).toBe(1248);
    expect(result.cases).toHaveLength(37);
    expect(result.cases.filter(c => c.type === 'COMMISSION_MISMATCH')).toHaveLength(12);
    expect(result.cases.filter(c => c.type === 'REFUND_WITH_ACTIVE_COMMISSION')).toHaveLength(10);
    expect(result.cases.filter(c => c.type === 'MISSING_PAYMENT')).toHaveLength(9);
    expect(result.cases.filter(c => c.type === 'DUPLICATE_PAYMENT')).toHaveLength(6);
  });

  it('identifica reembolso com comissão positiva sem concluir fraude', () => {
    const result = reconcile(parseImportedData(sampleOrdersCsv, sampleLedgerCsv));
    expect(result.examined).toBe(2);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0].type).toBe('REFUND_WITH_ACTIVE_COMMISSION');
    expect(result.cases[0].summary).not.toMatch(/fraude/i);
  });

  it('retorna taxa zero para um conjunto vazio', () => {
    expect(reconcile({ orders: [], ledger: [], source: 'upload' })).toEqual({
      examined: 0, clean: 0, cases: [], rate: 0,
    });
  });

  it('conta pedidos sem alerta, sem subtrair duas ocorrências do mesmo pedido duas vezes', () => {
    const bundle = validBundle();
    bundle.ledger = [];
    const result = reconcile(bundle);
    expect(result).toMatchObject({ examined: 1, clean: 0, rate: 0 });
    expect(result.cases.map(c => c.type)).toEqual(['MISSING_PAYMENT', 'COMMISSION_MISMATCH']);
  });

  it.each([
    [5, 1000, 1],
    [4, 1000, 0],
    [Number.MAX_SAFE_INTEGER, 10_000, Number.MAX_SAFE_INTEGER],
    [Number.MAX_SAFE_INTEGER, 9999, 9_006_298_534_815_517],
    [Number.MAX_SAFE_INTEGER, 0, 0],
  ])('calcula comissão exata: bruto %i centavos, taxa %i bps', (gross, rate, commission) => {
    expect(reconcile(validBundle(gross, rate, commission))).toMatchObject({ clean: 1, cases: [], rate: 100 });
  });

  it('soma parcelas de comissão e apresenta somente a diferença em centavos', () => {
    const bundle = validBundle(20_000, 2000, 1500);
    bundle.ledger.push({ id: 'C-2', orderId: 'ORDER-1', kind: 'commission', amountCents: 2499, at: '2026-11-21' });
    expect(reconcile(bundle).cases[0]).toMatchObject({ type: 'COMMISSION_MISMATCH', amountAtRiskCents: 1 });
  });

  it('não gera alerta de comissão quando o pedido reembolsado tem comissão zero', () => {
    const bundle = validBundle(20_000, 2000, 0);
    bundle.orders[0].status = 'refunded';
    expect(reconcile(bundle).cases).toEqual([]);
  });

  it('recusa perda de precisão em somas, mesmo fora do importador', () => {
    const bundle = validBundle(Number.MAX_SAFE_INTEGER, 10_000, Number.MAX_SAFE_INTEGER);
    bundle.ledger.push({ id: 'C-2', orderId: 'ORDER-1', kind: 'commission', amountCents: 1, at: '2026-11-21' });
    expect(() => reconcile(bundle)).toThrow(/soma.*limite seguro/);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('recusa inteiro inválido recebido diretamente: %s', value => {
    const bundle = validBundle();
    bundle.orders[0].grossCents = value;
    expect(() => reconcile(bundle)).toThrow(/inteiro não negativo/);
  });

  it('recusa lançamentos órfãos também fora do importador', () => {
    const bundle = validBundle();
    bundle.ledger[0].orderId = 'INEXISTENTE';
    expect(() => reconcile(bundle)).toThrow(/não existe/);
  });

  it('não modifica registros ou estado de entrada durante a análise', () => {
    const bundle = validBundle();
    const before = structuredClone(bundle);
    reconcile(bundle);
    expect(bundle).toEqual(before);
  });
});