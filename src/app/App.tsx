import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { AppProvider, useAppData } from './AppContext';
import { EvaluationProvider } from './EvaluationContext';
import { EvaluationPage } from '../pages/EvaluationPage';
import { AuditPage, CaseDetailPage, CasesPage, CopilotPage, DashboardPage, ReconciliationPage } from '../pages/Pages';

const Router = import.meta.env.BASE_URL === '/' ? BrowserRouter : HashRouter;

export default function App() {
  return <AppProvider><EvaluationProvider><Router><Routes><Route element={<RootShell/>}>
    <Route path="/dashboard" element={<DashboardPage/>}/>
    <Route path="/reconciliation" element={<ReconciliationPage/>}/>
    <Route path="/cases" element={<CasesPage/>}/>
    <Route path="/cases/:caseId" element={<CaseDetailPage/>}/>
    <Route path="/copilot" element={<CopilotPage/>}/>
    <Route path="/audit" element={<AuditPage/>}/>
    <Route path="/evaluation" element={<EvaluationPage/>}/>
    <Route path="*" element={<Navigate to="/dashboard" replace/>}/>
  </Route></Routes></Router></EvaluationProvider></AppProvider>;
}
function RootShell(){const {bundle,storageWarning}=useAppData();return <AppShell bundle={bundle} storageWarning={storageWarning}/>;}

