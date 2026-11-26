/** Modelos de domínio. Valores monetários são sempre inteiros em centavos. */
export type OrderStatus = 'approved' | 'refunded';
export type EntryKind = 'payment' | 'commission' | 'refund';
export type CaseSeverity = 'critical' | 'warning';
export type CaseStatus = 'open' | 'in_review' | 'resolved';
export type IssueType = 'COMMISSION_MISMATCH' | 'MISSING_PAYMENT' | 'REFUND_WITH_ACTIVE_COMMISSION' | 'DUPLICATE_PAYMENT';

export interface Order {
  id: string;
  date: string;
  grossCents: number;
  status: OrderStatus;
  creatorId: string;
  commissionRateBps: number;
}
export interface LedgerEntry {
  id: string;
  orderId: string;
  kind: EntryKind;
  amountCents: number;
  at: string;
}
export interface InvestigationCase {
  id: string;
  orderId: string;
  type: IssueType;
  severity: CaseSeverity;
  status: CaseStatus;
  summary: string;
  evidence: string[];
  suggestedActions: string[];
  createdAt: string;
  amountAtRiskCents: number;
}
export interface AuditEvent {
  id: string;
  caseId: string;
  action: string;
  /** Estado registrado no momento da decisao; opcional para historicos legados. */
  status?: CaseStatus;
  at: string;
  actor: string;
  note?: string;
}
export interface DataBundle {
  orders: Order[];
  ledger: LedgerEntry[];
  source: 'demo' | 'upload';
}
export interface ReconciliationSummary {
  examined: number;
  clean: number;
  cases: InvestigationCase[];
  rate: number;
}

