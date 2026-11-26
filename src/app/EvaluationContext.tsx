import * as React from 'react';
import { buildEvaluationPlan, scoreEvaluationTrial } from '../domain/evaluation';
import type { DataBundle } from '../domain/types';
import { useAppData } from './AppContext';

type Plan = ReturnType<typeof buildEvaluationPlan>;
type Task = Plan['tasks'][number];
type Trial = ReturnType<typeof scoreEvaluationTrial>;
type Variant = Plan['variant'];
type Prediction = Trial['predicted'];
type Phase = 'ready' | 'running' | 'feedback' | 'complete';
interface State {
  bundle: DataBundle;
  plan: Plan | null;
  variant: Variant;
  sessionId: string | null;
  taskIndex: number;
  phase: Phase;
  startedAt: number | null;
  trials: readonly Trial[];
  feedback: Trial | null;
  prediction: Prediction | null;
  error: string;
}
type Action =
  | { type: 'replace'; bundle: DataBundle }
  | { type: 'start'; bundle: DataBundle; now: number; sessionId: string }
  | { type: 'submit'; bundle: DataBundle; now: number; completedAt: string; prediction: Prediction | null }
  | { type: 'choose'; bundle: DataBundle; prediction: Prediction }
  | { type: 'next'; bundle: DataBundle }
  | { type: 'restart'; bundle: DataBundle };

/** Cria somente o plano; nenhuma medição ou resposta existe antes de uma interação. */
function initialState(bundle: DataBundle, variant: Variant = 'A'): State {
  let plan: Plan | null = null;
  let error = '';
  if (bundle.source === 'demo') {
    try { plan = buildEvaluationPlan(bundle, variant); }
    catch (reason) { error = reason instanceof Error ? reason.message : 'Não foi possível preparar as tarefas da demonstração.'; }
  }
  return { bundle, plan, variant, sessionId: null, taskIndex: 0, phase: 'ready', startedAt: null, trials: [], feedback: null, prediction: null, error };
}

/** Transições atômicas impedem reenvio e mantêm o resultado de cada tarefa inalterado. */
function reducer(state: State, action: Action): State {
  if (action.type === 'replace') return state.bundle === action.bundle ? state : initialState(action.bundle, state.variant);
  if (state.bundle !== action.bundle || !state.plan) return state;
  if (action.type === 'restart') return initialState(state.bundle, state.variant === 'A' ? 'B' : 'A');
  const task = state.plan.tasks[state.taskIndex];
  if (!task) return state;
  if (action.type === 'start') {
    if (state.phase !== 'ready') return state;
    return { ...state, phase: 'running', startedAt: action.now, sessionId: state.sessionId ?? action.sessionId, error: '' };
  }
  if (action.type === 'choose') return state.phase === 'running' ? { ...state, prediction: action.prediction, error: '' } : state;
  if (action.type === 'submit') {
    if (state.phase !== 'running' || state.startedAt === null || !state.sessionId) return state;
    if (!action.prediction) return { ...state, error: 'Escolha uma classificação antes de registrar a resposta.' };
    try {
      const trial = Object.freeze(scoreEvaluationTrial(task, {
        sessionId: state.sessionId, predicted: action.prediction,
        elapsedMs: action.now - state.startedAt, completedAt: action.completedAt,
      }));
      return { ...state, phase: 'feedback', startedAt: null, trials: [...state.trials, trial], feedback: trial, error: '' };
    } catch (reason) {
      return { ...state, error: reason instanceof Error ? reason.message : 'Não foi possível registrar a resposta. Tente novamente.' };
    }
  }
  if (action.type === 'next' && state.phase === 'feedback') {
    const complete = state.taskIndex + 1 >= state.plan.tasks.length;
    return { ...state, phase: complete ? 'complete' : 'ready', taskIndex: complete ? state.taskIndex : state.taskIndex + 1, feedback: null, prediction: null, error: '' };
  }
  return state;
}

interface EvaluationContextValue {
  available: boolean;
  variant: Variant;
  sessionId: string | null;
  task: Task | null;
  taskIndex: number;
  taskCount: number;
  phase: Phase;
  trials: readonly Trial[];
  feedback: Trial | null;
  startedAt: number | null;
  prediction: Prediction | null;
  error: string;
  startTask: () => void;
  choosePrediction: (prediction: Prediction) => void;
  submitAnswer: (prediction: Prediction | null) => void;
  nextTask: () => void;
  restart: () => void;
}
const EvaluationContext = React.createContext<EvaluationContextValue | null>(null);

/** Acesso ao ensaio temporário; exige EvaluationProvider dentro de AppProvider. */
export function useEvaluation(): EvaluationContextValue {
  const value = React.useContext(EvaluationContext);
  if (!value) throw new Error('useEvaluation precisa estar dentro de EvaluationProvider.');
  return value;
}

/**
 * Mantém o ensaio em memória entre rotas. Uma troca de base descarta o ensaio,
 * mas decisões sobre casos preservam a referência do bundle e não o reiniciam.
 * O relógio monotônico continua durante navegação e pausas; nenhum dado é persistido.
 */
export function EvaluationProvider({ children }: { children: React.ReactNode }) {
  const { bundle } = useAppData();
  const [state, dispatch] = React.useReducer(reducer, bundle, initialState);
  React.useEffect(() => { dispatch({ type: 'replace', bundle }); }, [bundle]);
  // Antes de o efeito aplicar a troca, resultados da base anterior já ficam invisíveis.
  const current = state.bundle === bundle ? state : initialState(bundle, state.variant);
  const value: EvaluationContextValue = {
    available: Boolean(current.plan), variant: current.variant, sessionId: current.sessionId,
    task: current.plan?.tasks[current.taskIndex] ?? null, taskIndex: current.taskIndex,
    taskCount: current.plan?.tasks.length ?? 0, phase: current.phase,
    trials: current.trials, feedback: current.feedback, startedAt: current.startedAt, prediction: current.prediction, error: current.error,
    startTask: () => dispatch({ type: 'start', bundle, now: performance.now(), sessionId: crypto.randomUUID() }),
    choosePrediction: prediction => dispatch({ type: 'choose', bundle, prediction }),
    submitAnswer: prediction => dispatch({ type: 'submit', bundle, prediction, now: performance.now(), completedAt: new Date().toISOString() }),
    nextTask: () => dispatch({ type: 'next', bundle }),
    restart: () => dispatch({ type: 'restart', bundle }),
  };
  return <EvaluationContext.Provider value={value}>{children}</EvaluationContext.Provider>;
}