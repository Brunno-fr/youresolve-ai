import type { AuditEvent, CaseStatus } from './types';

export interface StoredWorkflow {
  statuses: Record<string, CaseStatus>;
  audit: AuditEvent[];
}
export const MAX_NOTE_LENGTH = 4000;
export const WORKFLOW_STORAGE_KEY = 'youresolve-demo-workflow-v1';
const ACTIONS: Record<CaseStatus, string> = {
  open: 'Ocorrência reaberta',
  in_review: 'Investigação iniciada',
  resolved: 'Ocorrência resolvida',
};

/** Retorna um fluxo novo, sem compartilhar referências entre conjuntos de dados. */
export function emptyWorkflow(): StoredWorkflow {
  return { statuses: {}, audit: [] };
}

/** Valida os únicos estados aceitos pela investigação; não corresponde a uma ação financeira. */
export function isCaseStatus(value: unknown): value is CaseStatus {
  return value === 'open' || value === 'in_review' || value === 'resolved';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lê somente decisões da demonstração, tratando localStorage como entrada não confiável.
 * @param raw JSON salvo no navegador, ou null se não existir.
 * @param knownCaseIds IDs da base sintética; registros de outros conjuntos são descartados.
 * @returns Fluxo normalizado, ou vazio quando o formato é inválido.
 * @remarks Não é auditoria imutável. Decisões sem evento válido são desconsideradas.
 */
export function parseStoredWorkflow(raw: string | null, knownCaseIds: ReadonlySet<string>): StoredWorkflow {
  if (!raw || raw.length > 4_000_000) return emptyWorkflow();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || !isObject(parsed.statuses) || !Array.isArray(parsed.audit)) return emptyWorkflow();
    const audit: AuditEvent[] = [];
    const eventIds = new Set<string>();
    for (const item of parsed.audit) {
      if (!isObject(item) || typeof item.id !== 'string' || !item.id || item.id.length > 160 || eventIds.has(item.id)) continue;
      if (typeof item.caseId !== 'string' || !knownCaseIds.has(item.caseId)) continue;
      if (typeof item.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(item.at) || !Number.isFinite(Date.parse(item.at))) continue;
      // O aplicativo salva UTC canônico; o round-trip rejeita datas normalizadas e horários sem fuso.
      if (new Date(item.at).toISOString() !== item.at) continue;
      if (typeof item.actor !== 'string' || !item.actor.trim() || item.actor.length > 160) continue;
      if (item.note !== undefined && typeof item.note !== 'string') continue;
      const note = typeof item.note === 'string' ? item.note.trim() : '';
      const status = isCaseStatus(item.status) ? item.status : (Object.keys(ACTIONS) as CaseStatus[]).find(key => ACTIONS[key] === item.action);
      if (!status || note.length > MAX_NOTE_LENGTH || (status === 'resolved' && note.length < 12)) continue;
      eventIds.add(item.id);
      audit.push({ id: item.id, caseId: item.caseId, action: ACTIONS[status], status, at: item.at, actor: item.actor, note });
    }
    // A ordenação estável conserva o evento mais novo primeiro quando dois cliques têm o mesmo timestamp.
    audit.sort((a, b) => b.at.localeCompare(a.at));
    const statuses: Record<string, CaseStatus> = {};
    for (const event of audit) {
      if (!Object.hasOwn(statuses, event.caseId) && event.status) statuses[event.caseId] = event.status;
    }
    return { statuses, audit };
  } catch {
    return emptyWorkflow();
  }
}

/**
 * Registra uma transição humana e sua justificativa sem modificar pedidos ou lançamentos.
 * @param workflow Estado anterior, com eventos em ordem do mais novo para o mais antigo.
 * @param caseId Ocorrência previamente validada pelo chamador.
 * @param status Novo estado; resolução exige pelo menos 12 caracteres na nota.
 * @param note Justificativa em texto simples, limitada a 4.000 caracteres.
 * @param event Metadados gerados pelo aplicativo (id único, instante ISO e ator).
 * @returns Novo fluxo ou null para transição inválida/repetida; não possui efeitos colaterais.
 */
export function transitionWorkflow(
  workflow: StoredWorkflow,
  caseId: string,
  status: CaseStatus,
  note: string,
  event: Pick<AuditEvent, 'id' | 'at' | 'actor'>,
): StoredWorkflow | null {
  const trimmed = note.trim();
  if (!isCaseStatus(status) || (workflow.statuses[caseId] ?? 'open') === status) return null;
  if (trimmed.length > MAX_NOTE_LENGTH || (status === 'resolved' && trimmed.length < 12)) return null;
  return {
    statuses: { ...workflow.statuses, [caseId]: status },
    audit: [{ ...event, caseId, action: ACTIONS[status], status, note: trimmed }, ...workflow.audit],
  };
}
