import { describe, expect, it } from 'vitest';
import { buildDemoData } from '../src/domain/fixtures';
import { buildEvaluationPlan, EVALUATION_CLASSIFICATIONS, scoreEvaluationTrial, summarizeEvaluation, type EvaluationClassification, type EvaluationTask } from '../src/domain/evaluation';

const completedAt = '2026-11-26T10:00:00.000Z';
const score = (task: EvaluationTask, elapsedMs: number, predicted: EvaluationClassification = task.expected, sessionId = 'session-1') => scoreEvaluationTrial(task, { sessionId, predicted, elapsedMs, completedAt });

describe('plano de avaliação com o conjunto sintético compartilhado', () => {
  it('seleciona dez pedidos distintos, cinco pares e cinco tarefas por modo', () => {
    const bundle = buildDemoData(), before = structuredClone(bundle);
    const { tasks } = buildEvaluationPlan(bundle, 'A');
    expect(tasks).toHaveLength(10);
    expect(new Set(tasks.map(task => task.orderId)).size).toBe(10);
    for (let index = 0; index < 5; index++) expect(tasks[index].pairId).toBe(tasks[index + 5].pairId);
    tasks.slice(1).forEach((task, index) => expect(task.mode).not.toBe(tasks[index].mode));
    expect(tasks.filter(task => task.mode === 'manual')).toHaveLength(5);
    expect(tasks.filter(task => task.mode === 'assisted')).toHaveLength(5);
    for (const category of EVALUATION_CLASSIFICATIONS) {
      const pair = tasks.filter(task => task.expected === category);
      expect(pair).toHaveLength(2);
      expect(pair[0].pairId).toBe(pair[1].pairId);
      expect(pair[0].ledger.map(item => item.kind).sort()).toEqual(pair[1].ledger.map(item => item.kind).sort());
      expect(pair[0].order.commissionRateBps).toBe(pair[1].order.commissionRateBps);
    }
    expect(bundle).toEqual(before);
    tasks[0].order.grossCents = 0;
    expect(bundle).toEqual(before);
  });
  it('contrabalanceia os mesmos pedidos sem trocar a referência esperada', () => {
    const bundle = buildDemoData();
    const a = buildEvaluationPlan(bundle, 'A').tasks, b = buildEvaluationPlan(bundle, 'B').tasks;
    a.forEach((task, index) => {
      expect(task.orderId).toBe(b[index].orderId);
      expect(task.expected).toBe(b[index].expected);
      expect(task.mode).not.toBe(b[index].mode);
    });
  });
  it('recusa importação e conjuntos sem pares suficientes', () => {
    expect(() => buildEvaluationPlan({ ...buildDemoData(), source: 'upload' }, 'A')).toThrow(/sintética/);
    expect(() => buildEvaluationPlan({ orders: [], ledger: [], source: 'demo' }, 'A')).toThrow(/comparáveis/);
  });
  it('não utiliza pedidos com múltiplas categorias de alerta', () => {
    const bundle = buildDemoData();
    const excluded = bundle.orders[0].id;
    bundle.ledger = bundle.ledger.filter(item => !(item.orderId === excluded && item.kind === 'payment'));
    expect(buildEvaluationPlan(bundle, 'A').tasks.some(task => task.orderId === excluded)).toBe(false);
  });
});

describe('registro de respostas reais', () => {
  const task = buildEvaluationPlan(buildDemoData(), 'A').tasks[0];
  it('conserva tempo fracionário medido e classifica a resposta sem inventar duração', () => {
    expect(score(task, 1250.75)).toMatchObject({ elapsedMs: 1250.75, correct: true, completedAt });
    expect(score(task, 1200, 'NONE').correct).toBe(false);
  });
  it.each([0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('recusa tempo inválido %s', elapsedMs => {
    expect(() => score(task, elapsedMs)).toThrow(/Tempo/);
  });
  it('recusa sessão vazia e data civil inexistente ou sem fuso', () => {
    expect(() => score(task, 1000, task.expected, '')).toThrow(/sessão/);
    for (const at of ['2026-02-30T10:00:00.000Z', '2026-11-26T10:00:00']) {
      expect(() => scoreEvaluationTrial(task, { sessionId: 's', predicted: task.expected, elapsedMs: 1000, completedAt: at })).toThrow(/Instante/);
    }
  });
});

describe('métricas descritivas sem resultados fabricados', () => {
  const tasks = buildEvaluationPlan(buildDemoData(), 'A').tasks;
  it('mantém métricas nulas até coletar respostas', () => {
    const summary = summarizeEvaluation([]);
    expect(summary.modes.manual).toMatchObject({ count: 0, accuracy: null, medianElapsedMs: null, falsePositiveRate: null });
    expect(summary.paired).toEqual({ count: 0, meanTimeDifferenceMs: null, medianTimeDifferenceMs: null, accuracyDifference: null });
  });
  it('não compara modos enquanto o par estiver incompleto', () => {
    const summary = summarizeEvaluation([score(tasks[0], 3000)]);
    expect(summary.modes.manual.count).toBe(1);
    expect(summary.paired.count).toBe(0);
    expect(summary.paired.meanTimeDifferenceMs).toBeNull();
  });
  it('compara pares completos incluindo respostas incorretas', () => {
    const results = [score(tasks[0], 3000), score(tasks[5], 1000, 'NONE')];
    const summary = summarizeEvaluation(results);
    expect(summary.paired).toEqual({ count: 1, meanTimeDifferenceMs: -2000, medianTimeDifferenceMs: -2000, accuracyDifference: -1 });
    expect(summary.modes.assisted).toMatchObject({ count: 1, correct: 0, falseNegatives: 1 });
  });
  it('mede mediana e acerto em todas as dez respostas coletadas', () => {
    const summary = summarizeEvaluation(tasks.map((task, index) => score(task, (index + 1) * 1000)));
    expect(summary.paired.count).toBe(5);
    expect(summary.modes.manual).toMatchObject({ count: 5, correct: 5, accuracy: 1, medianElapsedMs: 5000 });
    expect(summary.modes.assisted).toMatchObject({ count: 5, correct: 5, accuracy: 1, medianElapsedMs: 6000 });
  });
  it('separa falsos positivos, falsos negativos e categoria errada', () => {
    const negative = tasks.find(task => task.expected === 'NONE' && task.mode === 'manual')!;
    const summary = summarizeEvaluation([score(negative, 1000, 'MISSING_PAYMENT'), score(tasks[0], 2000, 'DUPLICATE_PAYMENT')]);
    expect(summary.modes.manual).toMatchObject({ negativeCount: 1, falsePositives: 1, falsePositiveRate: 1, wrongCategories: 1, falseNegatives: 0 });
  });
  it('não combina participantes ou variantes diferentes para completar pares', () => {
    expect(summarizeEvaluation([score(tasks[0], 1000), score(tasks[5], 1500, tasks[5].expected, 'session-2')]).paired.count).toBe(0);
    const other = buildEvaluationPlan(buildDemoData(), 'B').tasks[0];
    expect(summarizeEvaluation([score(tasks[0], 1000), score(other, 1500, other.expected, 'session-2')]).paired.count).toBe(0);
  });
  it('recusa duplicação ou alteração inconsistente de um resultado', () => {
    const trial = score(tasks[0], 1000);
    expect(() => summarizeEvaluation([trial, trial])).toThrow(/duplicada/);
    expect(() => summarizeEvaluation([{ ...trial, correct: false }])).toThrow(/inconsistente/);
    expect(() => summarizeEvaluation([trial, { ...score(tasks[5], 1000), orderId: trial.orderId }])).toThrow(/incompatível/);
  });
});

