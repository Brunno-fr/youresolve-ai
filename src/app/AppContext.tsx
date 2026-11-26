import * as React from 'react';
import { buildDemoData } from '../domain/fixtures';
import { reconcile } from '../domain/reconciliation';
import { emptyWorkflow, parseStoredWorkflow, transitionWorkflow, WORKFLOW_STORAGE_KEY, type StoredWorkflow } from '../domain/workflow';
import type { AuditEvent, CaseStatus, DataBundle, InvestigationCase, ReconciliationSummary } from '../domain/types';

interface AppContextType {
  bundle: DataBundle;
  summary: ReconciliationSummary;
  cases: InvestigationCase[];
  audit: AuditEvent[];
  storageWarning: string;
  loadData: (bundle: DataBundle) => void;
  updateCase: (id: string, status: CaseStatus, note: string) => boolean;
  resetDemo: () => void;
}
interface AppState { bundle: DataBundle; workflow: StoredWorkflow }
const AppContext = React.createContext<AppContextType | null>(null);

/** Acesso ao estado compartilhado; exige um AppProvider na árvore React. */
export function useAppData(): AppContextType {
  const value = React.useContext(AppContext);
  if (!value) throw new Error('useAppData precisa estar dentro do AppContext.');
  return value;
}

function initialState(): AppState {
  const bundle = buildDemoData();
  let workflow = emptyWorkflow();
  try {
    const knownCaseIds = new Set(reconcile(bundle).cases.map(item => item.id));
    workflow = parseStoredWorkflow(localStorage.getItem(WORKFLOW_STORAGE_KEY), knownCaseIds);
  } catch { /* O aplicativo permanece utilizável quando o navegador bloqueia armazenamento. */ }
  return { bundle, workflow };
}

/**
 * Fonte única para todas as páginas. Trocas de base e fluxo são atômicas para impedir
 * que decisões de um CSV sejam associadas a outra importação ou persistidas na demonstração.
 */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AppState>(initialState);
  const [storageWarning, setStorageWarning] = React.useState('');
  const { bundle, workflow } = state;
  const summary = React.useMemo(() => reconcile(bundle), [bundle]);
  const cases = React.useMemo(() => summary.cases.map(c => ({ ...c, status: workflow.statuses[c.id] ?? c.status })), [summary, workflow.statuses]);
  React.useEffect(() => {
    if (bundle.source !== 'demo') { setStorageWarning(''); return; }
    try {
      localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(workflow));
      setStorageWarning('');
    } catch {
      setStorageWarning('O navegador não conseguiu salvar o histórico. As decisões ficarão somente nesta sessão.');
    }
  }, [workflow, bundle.source]);

  const loadData = (next: DataBundle) => {
    // O mesmo domínio valida o conjunto antes da substituição: falhas preservam a base atual.
    reconcile(next);
    setState({ bundle: next, workflow: emptyWorkflow() });
  };
  const resetDemo = () => setState({ bundle: buildDemoData(), workflow: emptyWorkflow() });

  /** Resolução exige justificativa; transições repetidas não geram eventos duplicados. */
  const updateCase = (id: string, status: CaseStatus, note: string) => {
    if (!cases.some(c => c.id === id)) return false;
    const event = { id: `EV-${crypto.randomUUID()}`, at: new Date().toISOString(), actor: bundle.source === 'demo' ? 'Analista (demonstração)' : 'Analista (sessão local)' };
    if (!transitionWorkflow(workflow, id, status, note, event)) return false;
    setState(previous => {
      if (previous.bundle !== bundle) return previous;
      const nextWorkflow = transitionWorkflow(previous.workflow, id, status, note, event);
      return nextWorkflow ? { ...previous, workflow: nextWorkflow } : previous;
    });
    return true;
  };
  const value: AppContextType = { bundle, summary, cases, audit: workflow.audit, storageWarning, loadData, updateCase, resetDemo };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
