import type { DataBundle, LedgerEntry, Order } from './types';

/**
 * Base 100% sintética: casos exemplificam hipóteses, NÃO dados da YouShop.
 * 1.285 pedidos: 12 diferenças de comissão, 10 revisões por reembolso,
 * 9 ausências de pagamento e 6 eventos de pagamento duplicados.
 */
export function buildDemoData(): DataBundle {
  const orders: Order[] = [];
  const ledger: LedgerEntry[] = [];
  const start = Date.UTC(2026, 10, 1);
  for (let i = 0; i < 1285; i++) {
    const id = `YS-${String(2001 + i).padStart(5, '0')}`;
    const date = new Date(start + (i % 25) * 86_400_000).toISOString().slice(0, 10);
    const grossCents = 5000 + ((i * 79) % 520) * 100;
    const status: Order['status'] = i >= 12 && i < 22 ? 'refunded' : 'approved';
    const rate = 2000;
    orders.push({ id, date, grossCents, status, creatorId: `CR-${1 + i % 24}`, commissionRateBps: rate });
    const commission = Math.round(grossCents * rate / 10_000);
    if (i < 12) {
      ledger.push({ id: `C-${i}`, orderId: id, kind: 'commission', amountCents: commission + 150, at: date });
    } else {
      ledger.push({ id: `C-${i}`, orderId: id, kind: 'commission', amountCents: commission, at: date });
    }
    if (i < 22 || i >= 31) {
      ledger.push({ id: `P-${i}`, orderId: id, kind: 'payment', amountCents: grossCents, at: date });
    }
    if (i >= 31 && i < 37) {
      ledger.push({ id: `P-DUP-${i}`, orderId: id, kind: 'payment', amountCents: grossCents, at: date });
    }
    if (status === 'refunded') {
      ledger.push({ id: `R-${i}`, orderId: id, kind: 'refund', amountCents: grossCents, at: date });
    }
  }
  return { orders, ledger, source: 'demo' };
}
