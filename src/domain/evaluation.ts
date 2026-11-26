import { reconcile } from './reconciliation';
import type { DataBundle, IssueType, LedgerEntry, Order } from './types';

export type EvaluationMode = 'manual' | 'assisted';
export type EvaluationVariant = 'A' | 'B';
export type EvaluationClassification = IssueType | 'NONE';
export const EVALUATION_CLASSIFICATIONS: readonly EvaluationClassification[] = [
  'COMMISSION_MISMATCH', 'REFUND_WITH_ACTIVE_COMMISSION', 'MISSING_PAYMENT', 'DUPLICATE_PAYMENT', 'NONE',
];
export interface EvaluationTask {
  id: string; pairId: string; orderId: string; variant: EvaluationVariant;
  mode: EvaluationMode; expected: EvaluationClassification;
  order: Order; ledger: LedgerEntry[]; evidence: string[]; suggestedActions: string[];
}
export interface EvaluationPlan { variant: EvaluationVariant; tasks: EvaluationTask[] }
export interface EvaluationTrial {
  sessionId: string; taskId: string; pairId: string; orderId: string;
  variant: EvaluationVariant; mode: EvaluationMode; predicted: EvaluationClassification;
  expected: EvaluationClassification; correct: boolean; elapsedMs: number; completedAt: string;
}
export interface EvaluationModeSummary {
  count: number; correct: number; accuracy: number | null;
  meanElapsedMs: number | null; medianElapsedMs: number | null;
  negativeCount: number; positiveCount: number; falsePositives: number; falseNegatives: number;
  wrongCategories: number; falsePositiveRate: number | null;
}
export interface EvaluationSummary {
  modes: Record<EvaluationMode, EvaluationModeSummary>;
  paired: { count: number; meanTimeDifferenceMs: number | null; medianTimeDifferenceMs: number | null; accuracyDifference: number | null };
}

function isClassification(value: unknown): value is EvaluationClassification {
  return EVALUATION_CLASSIFICATIONS.includes(value as EvaluationClassification);
}
function mean(values: number[]): number | null {
  return values.length ? values.reduce((total, value) => total + value / values.length, 0) : null;
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2;
}

/**
 * Seleciona dez tarefas do mesmo conjunto sintético usado pelo aplicativo.
 * @param bundle Demonstração validada; importações são recusadas para preservar o protocolo.
 * @param variant A ou B, invertendo o modo atribuído aos mesmos pedidos de cada par.
 * @returns Cinco pares (quatro alertas e um negativo), sem repetir pedidos.
 * @throws Se a fonte não for demo, a variante for inválida ou faltarem pares comparáveis.
 * @remarks Pareamento por categoria, quantidade/tipos de lançamentos e taxa em bps.
 * Não garante dificuldade cognitiva igual nem equivalência a operações reais.
 */
export function buildEvaluationPlan(bundle: DataBundle, variant: EvaluationVariant): EvaluationPlan {
  if (bundle.source !== 'demo') throw new Error('A avaliação utiliza somente a demonstração sintética.');
  if (variant !== 'A' && variant !== 'B') throw new Error('Variante de avaliação inválida.');
  const summary = reconcile(bundle);
  const byOrder = new Map<string, typeof summary.cases>();
  for (const item of summary.cases) byOrder.set(item.orderId, [...(byOrder.get(item.orderId) ?? []), item]);
  const ledgerByOrder = new Map<string, LedgerEntry[]>();
  for (const entry of bundle.ledger) ledgerByOrder.set(entry.orderId, [...(ledgerByOrder.get(entry.orderId) ?? []), entry]);
  const tasks: EvaluationTask[] = [];
  for (const [pairIndex, expected] of EVALUATION_CLASSIFICATIONS.entries()) {
    const groups = new Map<string, Order[]>();
    for (const order of bundle.orders) {
      const cases = byOrder.get(order.id) ?? [];
      if (cases.length > 1 || (cases[0]?.type ?? 'NONE') !== expected) continue;
      const ledger = ledgerByOrder.get(order.id) ?? [];
      const signature = `${order.commissionRateBps}:${ledger.map(entry => entry.kind).sort().join(',')}`;
      groups.set(signature, [...(groups.get(signature) ?? []), order]);
    }
    const group = [...groups.values()].find(items => items.length >= 2);
    if (!group) throw new Error('A demonstração não contém dois pedidos comparáveis para cada categoria.');
    for (let side = 0; side < 2; side++) {
      const order = group[side], occurrence = byOrder.get(order.id)?.[0];
      const manualFirst = (pairIndex % 2 === 0) === (variant === 'A');
      tasks.push({
        id: `TASK-${pairIndex * 2 + side + 1}`, pairId: `PAIR-${pairIndex + 1}`, orderId: order.id, variant,
        mode: (side === 0) === manualFirst ? 'manual' : 'assisted', expected,
        order: { ...order }, ledger: (ledgerByOrder.get(order.id) ?? []).map(entry => ({ ...entry })),
        evidence: occurrence ? [...occurrence.evidence] : ['Nenhuma das quatro regras avaliadas encontrou um alerta neste pedido.'],
        suggestedActions: occurrence ? [...occurrence.suggestedActions] : ['A ausência de alerta não comprova conciliação bancária ou correção contábil.'],
      });
    }
  }
  // Separa os membros de cada par por cinco tarefas para reduzir a lembrança imediata.
  const spaced = [...tasks.filter((_, index) => index % 2 === 0), ...tasks.filter((_, index) => index % 2 === 1)];
  return { variant, tasks: spaced };
}

/**
 * Congela a resposta efetiva do participante contra a referência das quatro regras.
 * @param task Tarefa da sessão, gerada pelo plano sintético.
 * @param input Resposta e tempo decorrido em milissegundos, medidos pelo chamador com performance.now.
 * @returns Registro sem efeitos colaterais; correto significa coincidência com o cenário, não decisão financeira.
 * @throws Para classificação, tempo, sessão ou timestamp inválidos.
 */
export function scoreEvaluationTrial(task: EvaluationTask, input: {
  sessionId: string; predicted: EvaluationClassification; elapsedMs: number; completedAt: string;
}): EvaluationTrial {
  if (!input.sessionId.trim() || input.sessionId.length > 160 || /[\u0000-\u001f\u007f]/.test(input.sessionId)) throw new Error('Identificador de sessão inválido.');
  if (!isClassification(input.predicted) || !isClassification(task.expected)) throw new Error('Selecione uma classificação válida.');
  if (!Number.isFinite(input.elapsedMs) || input.elapsedMs <= 0 || input.elapsedMs > Number.MAX_SAFE_INTEGER) throw new Error('Tempo de avaliação inválido. Reinicie a tarefa.');
  if (!Number.isFinite(Date.parse(input.completedAt)) || new Date(input.completedAt).toISOString() !== input.completedAt) throw new Error('Instante da resposta inválido.');
  return {
    sessionId: input.sessionId, taskId: task.id, pairId: task.pairId, orderId: task.orderId,
    variant: task.variant, mode: task.mode, expected: task.expected, predicted: input.predicted,
    correct: input.predicted === task.expected, elapsedMs: input.elapsedMs, completedAt: input.completedAt,
  };
}

function summarizeMode(trials: EvaluationTrial[]): EvaluationModeSummary {
  const correct = trials.filter(item => item.correct).length;
  const negativeCount = trials.filter(item => item.expected === 'NONE').length;
  const falsePositives = trials.filter(item => item.expected === 'NONE' && item.predicted !== 'NONE').length;
  return {
    count: trials.length, correct, accuracy: trials.length ? correct / trials.length : null,
    meanElapsedMs: mean(trials.map(item => item.elapsedMs)), medianElapsedMs: median(trials.map(item => item.elapsedMs)),
    negativeCount, positiveCount: trials.length - negativeCount, falsePositives,
    falseNegatives: trials.filter(item => item.expected !== 'NONE' && item.predicted === 'NONE').length,
    wrongCategories: trials.filter(item => item.expected !== 'NONE' && item.predicted !== 'NONE' && !item.correct).length,
    falsePositiveRate: negativeCount ? falsePositives / negativeCount : null,
  };
}

/**
 * Resume somente respostas coletadas; conjunto vazio produz métricas null, nunca números simulados.
 * @param trials Registros completos de respostas, com IDs únicos por sessão e tarefa.
 * @returns Contagens/tempos por modo e diferenças assistido menos manual em pares completos.
 * @throws Para duplicatas, registros inconsistentes ou pares com modos duplicados.
 * @remarks Inclui respostas incorretas no tempo. Diferenças são descritivas, sem significância
 * estatística, causalidade, promessa de produtividade ou comparação com IA generativa.
 */
export function summarizeEvaluation(trials: readonly EvaluationTrial[]): EvaluationSummary {
  const seen = new Set<string>();
  const pairs = new Map<string, Partial<Record<EvaluationMode, EvaluationTrial>>>();
  for (const trial of trials) {
    const identity = JSON.stringify([trial.sessionId, trial.taskId]);
    if (seen.has(identity)) throw new Error('Resposta duplicada para a mesma tarefa e sessão.');
    seen.add(identity);
    if ((trial.mode !== 'manual' && trial.mode !== 'assisted') || (trial.variant !== 'A' && trial.variant !== 'B') || !isClassification(trial.expected) || !isClassification(trial.predicted) || trial.correct !== (trial.expected === trial.predicted) || !Number.isFinite(trial.elapsedMs) || trial.elapsedMs <= 0 || trial.elapsedMs > Number.MAX_SAFE_INTEGER) throw new Error('Registro de avaliação inconsistente.');
    const pairKey = JSON.stringify([trial.sessionId, trial.variant, trial.pairId]);
    const pair = pairs.get(pairKey) ?? {};
    if (pair[trial.mode]) throw new Error('Duas respostas do mesmo modo no mesmo par.');
    pair[trial.mode] = trial; pairs.set(pairKey, pair);
  }
  const timeDifferences: number[] = [], accuracyDifferences: number[] = [];
  for (const pair of pairs.values()) {
    if (!pair.manual || !pair.assisted) continue;
    if (pair.manual.orderId === pair.assisted.orderId || pair.manual.expected !== pair.assisted.expected) throw new Error('Par de avaliação incompatível.');
    timeDifferences.push(pair.assisted.elapsedMs - pair.manual.elapsedMs);
    accuracyDifferences.push(Number(pair.assisted.correct) - Number(pair.manual.correct));
  }
  return {
    modes: { manual: summarizeMode(trials.filter(item => item.mode === 'manual')), assisted: summarizeMode(trials.filter(item => item.mode === 'assisted')) },
    paired: { count: timeDifferences.length, meanTimeDifferenceMs: mean(timeDifferences), medianTimeDifferenceMs: median(timeDifferences), accuracyDifference: mean(accuracyDifferences) },
  };
}

