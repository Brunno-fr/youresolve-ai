import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAppData } from '../app/AppContext';
import { YouResolveBento } from '../components/ui/YouResolveBento';
import { serializeCsv } from '../domain/csvExport';
import { MAX_NOTE_LENGTH } from '../domain/workflow';
import { dateLabel, integer, money, percent } from '../domain/format';
import { parseImportedData, sampleLedgerCsv, sampleOrdersCsv } from '../domain/reconciliation';
import type { CaseStatus, InvestigationCase } from '../domain/types';

const CASE_NAMES: Record<InvestigationCase['type'], string> = {
  COMMISSION_MISMATCH: 'Diferença de comissão', MISSING_PAYMENT: 'Pagamento não localizado',
  REFUND_WITH_ACTIVE_COMMISSION: 'Comissão após reembolso', DUPLICATE_PAYMENT: 'Registro de pagamento duplicado',
};
const STATUS: Record<CaseStatus, string> = { open: 'Aberto', in_review: 'Em análise', resolved: 'Resolvido' };
const SEVERITY = { critical: 'Crítico', warning: 'Atenção' } as const;
const ENTRY_NAMES = { payment: 'Pagamento registrado', commission: 'Comissão registrada', refund: 'Reembolso registrado' } as const;

/** Download no navegador: a URL temporária permanece válida até o navegador iniciar a leitura. */
function downloadCsv(filename: string, rows: string[][]) {
  const url = URL.createObjectURL(new Blob([serializeCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Header({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: React.ReactNode }) {
  return <header className="page-header"><div><span className="overline">{kicker}</span><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}
function StatusBadge({ status }: { status: CaseStatus }) { return <span className={`status-badge status-${status}`}>{STATUS[status]}</span>; }

export function DashboardPage() {
  const { bundle, summary, cases, audit } = useAppData();
  return <YouResolveBento bundle={bundle} summary={summary} cases={cases} audit={audit}/>;
}

/** Importação atômica: erros ou leituras canceladas preservam o conjunto já carregado. */
export function ReconciliationPage() {
  const { bundle, summary, loadData, resetDemo } = useAppData();
  const [ordersFile, setOrdersFile] = React.useState<File | null>(null);
  const [ledgerFile, setLedgerFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
  const [reading, setReading] = React.useState(false);
  const ordersInput = React.useRef<HTMLInputElement>(null), ledgerInput = React.useRef<HTMLInputElement>(null);
  const request = React.useRef(0);
  const navigate = useNavigate();
  React.useEffect(() => () => { request.current += 1; }, []);
  const clearFeedback = () => { request.current += 1; setReading(false); setError(''); setNotice(''); };
  const clearFiles = () => {
    setOrdersFile(null); setLedgerFile(null);
    if (ordersInput.current) ordersInput.current.value = '';
    if (ledgerInput.current) ledgerInput.current.value = '';
  };
  const restore = () => { clearFeedback(); clearFiles(); resetDemo(); setNotice('Demonstração restaurada. Decisões anteriores foram removidas.'); };
  const analyze = async () => {
    clearFeedback();
    if (!ordersFile || !ledgerFile) { setError('Selecione os dois arquivos CSV.'); return; }
    if (![ordersFile, ledgerFile].every(file => /\.csv$/i.test(file.name))) { setError('Os dois arquivos precisam ter a extensão .csv.'); return; }
    if ([ordersFile, ledgerFile].some(file => file.size > 1024 * 1024)) { setError('Cada arquivo deve ter no máximo 1 MB.'); return; }
    if ([ordersFile, ledgerFile].some(file => file.size === 0)) { setError('Um dos arquivos está vazio. Escolha um CSV com cabeçalho e registros.'); return; }
    const current = request.current;
    setReading(true);
    try {
      const buffers = await Promise.all([ordersFile.arrayBuffer(), ledgerFile.arrayBuffer()]);
      if (current !== request.current) return;
      let texts: string[];
      try { texts = buffers.map(buffer => new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
      catch { throw new Error('Salve os arquivos em UTF-8 antes de importar.'); }
      const next = parseImportedData(texts[0], texts[1]);
      loadData(next);
      setNotice(`${integer(next.orders.length)} pedidos carregados localmente. Confira os alertas abaixo ou abra as ocorrências.`);
    } catch (reason) {
      if (current === request.current) setError(reason instanceof Error ? reason.message : 'Não foi possível ler os arquivos. Selecione-os novamente.');
    } finally { if (current === request.current) setReading(false); }
  };
  const sample = () => {
    clearFeedback(); clearFiles(); loadData(parseImportedData(sampleOrdersCsv, sampleLedgerCsv));
    setNotice('Amostra carregada: 2 pedidos e 1 alerta de comissão após reembolso.');
  };
  return <>
    <Header kicker="CONCILIAÇÃO" title="Conciliação financeira" description="Compare pedidos e lançamentos por regras verificáveis. Seus arquivos são lidos apenas neste navegador."
      action={<button className="button button-subtle" type="button" onClick={restore}>Restaurar demonstração</button>}/>
    <div className="stat-strip"><div><span>Pedidos analisados</span><strong>{integer(summary.examined)}</strong></div><div><span>Sem alertas</span><strong>{integer(summary.clean)}</strong></div><div><span>Alertas detectados</span><strong>{integer(summary.cases.length)}</strong></div><div><span>Índice sem alerta</span><strong>{percent(summary.rate)}</strong></div></div>
    <div className="section-grid"><section className="panel" aria-labelledby="import-title"><div className="panel-title"><h2 id="import-title">Importar registros</h2><span className="tag">{bundle.source === 'demo' ? 'Dados fictícios' : 'CSV local'}</span></div>
      <p className="helper">Use dados sintéticos, em CSV UTF-8 com vírgulas. Limite de 1 MB e 10.000 registros por arquivo. Valores em centavos: 20000 equivale a R$ 200,00.</p>
      <div className="file-field"><label htmlFor="orders-file">Arquivo de pedidos</label><input ref={ordersInput} id="orders-file" type="file" accept=".csv,text/csv" onChange={event => { clearFeedback(); setOrdersFile(event.target.files?.[0] ?? null); }}/></div>
      <div className="file-field"><label htmlFor="ledger-file">Arquivo de lançamentos</label><input ref={ledgerInput} id="ledger-file" type="file" accept=".csv,text/csv" onChange={event => { clearFeedback(); setLedgerFile(event.target.files?.[0] ?? null); }}/></div>
      {error && <p className="alert-error" role="alert">{error} O conjunto anterior foi mantido.</p>}
      {notice && <p className="alert-success" role="status">{notice}</p>}
      <div className="button-row"><button className="button button-primary" type="button" disabled={reading} aria-busy={reading} onClick={analyze}>{reading ? 'Analisando arquivos…' : 'Analisar arquivos'}</button><button className="button button-subtle" type="button" onClick={sample}>Carregar amostra</button></div>
      <div className="button-row"><button className="text-button" type="button" onClick={() => downloadCsv('orders-example.csv', sampleOrdersCsv.split('\n').map(row => row.split(',')))}>Baixar exemplo de pedidos</button><button className="text-button" type="button" onClick={() => downloadCsv('ledger-example.csv', sampleLedgerCsv.split('\n').map(row => row.split(',')))}>Baixar exemplo de lançamentos</button></div>
      <details className="csv-schema"><summary>Formato dos arquivos</summary><p>Os cabeçalhos precisam corresponder aos exemplos. Datas usam o formato AAAA-MM-DD.</p><strong>Pedidos</strong><code>id,date,grossCents,status,creatorId,commissionRateBps</code><p>status: approved ou refunded. A taxa é dada em pontos-base: 2000 equivale a 20%.</p><strong>Lançamentos</strong><code>id,orderId,kind,amountCents,at</code><p>kind: payment, commission ou refund. Cada orderId deve corresponder a um pedido importado.</p></details>
    </section><section className="panel"><div className="panel-title"><h2>Fluxo de verificação</h2><span className="tag tag-green">Regras transparentes</span></div>
      <ol className="steps"><li><strong>Importe os registros</strong><span>Pedidos e lançamentos com identificadores consistentes.</span></li><li><strong>Compare os eventos</strong><span>Quatro regras de pagamentos, comissões e reembolsos.</span></li><li><strong>Investigue os alertas</strong><span>Consulte os valores, as evidências e a linha do tempo.</span></li><li><strong>Registre sua decisão</strong><span>Justifique a conclusão e acompanhe o histórico.</span></li></ol>
      <p className="helper">Um alerta indica algo a investigar. Não comprova fraude nem autoriza uma correção financeira.</p>
      <p className="helper">Ao recarregar a página, o CSV e suas decisões são descartados. A demonstração usa armazenamento local.</p>
      <button className="button button-subtle" type="button" onClick={() => navigate('/cases')}>Abrir ocorrências</button>
    </section></div>
  </>;
}

/** Filtros na mesma fonte central do dashboard, sem criar cópias dos casos. */
export function CasesPage() {
  const { cases } = useAppData();
  const [query, setQuery] = React.useState(''), [status, setStatus] = React.useState('all');
  const [params, setParams] = useSearchParams();
  const requestedType = params.get('type') ?? 'all';
  const type = Object.hasOwn(CASE_NAMES, requestedType) ? requestedType : 'all';
  const filtered = cases.filter(item => (type === 'all' || item.type === type) && (status === 'all' || item.status === status) && `${item.id} ${item.summary} ${item.orderId}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')));
  return <><Header kicker="INVESTIGAÇÃO" title="Ocorrências financeiras" description="Consulte evidências, priorize investigações e registre decisões humanas." action={<span className="tag tag-green">{integer(cases.filter(item => item.status !== 'resolved').length)} pendências</span>}/>
    <section className="panel"><div className="filters"><label className="sr-only" htmlFor="case-search">Buscar ocorrências</label><input id="case-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por pedido ou descrição…"/>
      <label className="sr-only" htmlFor="case-type">Tipo</label><select id="case-type" value={type} onChange={event => setParams(event.target.value === 'all' ? {} : { type: event.target.value })}><option value="all">Todos os tipos</option>{Object.entries(CASE_NAMES).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
      <label className="sr-only" htmlFor="case-status">Status</label><select id="case-status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Todos os status</option><option value="open">Aberto</option><option value="in_review">Em análise</option><option value="resolved">Resolvido</option></select></div>
      <p className="helper" role="status">{integer(filtered.length)} de {integer(cases.length)} ocorrências</p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabela de ocorrências; deslize para ver todas as colunas"><table className="data-table"><thead><tr><th scope="col">Pedido / alerta</th><th scope="col">Tipo</th><th scope="col">Prioridade</th><th scope="col">Valor sob revisão</th><th scope="col">Status</th><th scope="col">Data</th></tr></thead><tbody>{filtered.map(item => <tr key={item.id}><td><Link to={`/cases/${encodeURIComponent(item.id)}`}><strong>{item.orderId}</strong><small>{item.summary}</small></Link></td><td>{CASE_NAMES[item.type]}</td><td><span className={`severity-${item.severity}`}>{SEVERITY[item.severity]}</span></td><td>{money(item.amountAtRiskCents)}</td><td><StatusBadge status={item.status}/></td><td>{dateLabel(item.createdAt)}</td></tr>)}</tbody></table></div>
      {!filtered.length && <div className="empty-state"><p>Nenhuma ocorrência corresponde aos filtros.</p>{cases.length > 0 && <button type="button" className="text-button" onClick={() => { setQuery(''); setStatus('all'); setParams({}); }}>Limpar filtros</button>}</div>}
    </section></>;
}

/** Evidências e eventos originais permitem revisar a hipótese antes de registrar uma decisão. */
export function CaseDetailPage() {
  const { caseId } = useParams();
  const { bundle, cases, updateCase, audit } = useAppData();
  const [note, setNote] = React.useState(''), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
  const navigate = useNavigate();
  React.useEffect(() => { setNote(''); setError(''); setNotice(''); }, [caseId, bundle]);
  const current = cases.find(item => item.id === caseId);
  if (!current) return <section className="panel"><h1>Ocorrência não encontrada</h1><p>O caso pode pertencer a outro conjunto de dados.</p><Link className="button button-subtle" to="/cases">Voltar para ocorrências</Link></section>;
  const record = audit.filter(event => event.caseId === current.id);
  const order = bundle.orders.find(item => item.id === current.orderId);
  const timeline = [
    ...(order ? [{ id: order.id, at: order.date, title: 'Pedido registrado', amount: order.grossCents }] : []),
    ...bundle.ledger.filter(entry => entry.orderId === current.orderId).map(entry => ({ id: entry.id, at: entry.at, title: ENTRY_NAMES[entry.kind], amount: entry.amountCents })),
  ].sort((left, right) => left.at.localeCompare(right.at));
  const update = (status: CaseStatus) => {
    setNotice('');
    if (updateCase(current.id, status, note)) { setNote(''); setError(''); setNotice(`Decisão registrada: ${STATUS[status].toLocaleLowerCase('pt-BR')}.`); }
    else setError(status === 'resolved' && note.trim().length < 12 ? 'Para resolver, escreva uma justificativa com pelo menos 12 caracteres.' : 'Não foi possível registrar a mudança. Verifique o estado atual do caso.');
  };
  return <><Link className="text-button back-link" to="/cases">Voltar para ocorrências</Link><Header kicker="CASO FINANCEIRO" title={current.orderId} description={current.summary} action={<StatusBadge status={current.status}/>}/>
    <div className="detail-grid"><section className="panel"><h2>Evidências disponíveis</h2><p className="helper">Estas evidências vêm das regras de conciliação e dos registros carregados.</p><ul className="evidence-list">{current.evidence.map((evidence, index) => <li key={index}><p>{evidence}</p></li>)}</ul>
      <h2>Linha do tempo do pedido</h2><ol className="event-timeline">{timeline.map((event, index) => <li key={`${event.id}-${index}`}><div><time dateTime={event.at}>{dateLabel(event.at)}</time><strong>{event.title}</strong><small>{event.id}</small></div><span>{money(event.amount)}</span></li>)}</ol>
      <h2>Verificações sugeridas</h2><ul className="actions-list">{current.suggestedActions.map((action, index) => <li key={index}>{action}</li>)}</ul>
      <button className="button button-subtle" type="button" onClick={() => navigate(`/copilot?case=${encodeURIComponent(current.id)}`)}>Consultar copiloto sobre este caso</button>
    </section><section className="panel"><div className="panel-title"><h2>Decisão humana</h2><span className={`severity-${current.severity}`}>{SEVERITY[current.severity]}</span></div><div className="detail-stat"><span>Valor vinculado ao alerta</span><strong>{money(current.amountAtRiskCents)}</strong><small>Não representa necessariamente perda financeira.</small></div>
      <label htmlFor="decision-note" className="field-label">Justificativa da ação</label><textarea id="decision-note" rows={5} maxLength={MAX_NOTE_LENGTH} aria-describedby="decision-help" aria-invalid={Boolean(error)} placeholder="Descreva o que foi verificado e a razão da decisão…" value={note} onChange={event => { setNote(event.target.value); setError(''); }}/>
      <p id="decision-help" className="helper">Para resolver, registre pelo menos 12 caracteres. Limite de {integer(MAX_NOTE_LENGTH)} caracteres.</p>
      {error && <p className="alert-error" role="alert">{error}</p>}{notice && <p className="alert-success" role="status">{notice}</p>}
      <div className="button-row"><button className="button button-subtle" type="button" disabled={current.status === 'in_review'} onClick={() => update('in_review')}>Marcar em análise</button><button className="button button-primary" type="button" disabled={current.status === 'resolved'} onClick={() => update('resolved')}>Resolver ocorrência</button><button className="text-button" type="button" disabled={current.status === 'open'} onClick={() => update('open')}>Reabrir</button></div>
      <h2 className="history-title">Histórico de decisões</h2>{record.length ? record.map(event => <div className="audit-event" key={event.id}><strong>{event.action}</strong><small>{new Date(event.at).toLocaleString('pt-BR')} · {event.actor}</small><p>{event.note || 'Sem nota adicional.'}</p></div>) : <p className="helper">Nenhuma decisão registrada para esta ocorrência.</p>}
    </section></div>
  </>;
}

/** Simulação local: respostas programadas e contextualizadas, sem API nem modelo generativo. */
export function CopilotPage() {
  const { cases, summary, bundle } = useAppData();
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('case');
  const selected = requestedId ? cases.find(item => item.id === requestedId) : cases[0];
  const [prompt, setPrompt] = React.useState('');
  const [messages, setMessages] = React.useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const chatRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { setMessages([]); setPrompt(''); }, [bundle, selected?.id]);
  React.useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages]);
  const send = (text: string) => {
    const value = text.trim(); if (!value || value.length > 2000) return;
    let answer = `O conjunto contém ${integer(summary.examined)} pedidos e ${integer(summary.cases.length)} alertas. Abra uma ocorrência para consultar suas evidências.`;
    if (selected) {
      const question = value.toLocaleLowerCase('pt-BR');
      const details = question.includes('evidênc') ? `Evidências: ${selected.evidence.join(' ')}`
        : question.includes('cuidado') ? `Antes de concluir: ${selected.suggestedActions.join(' ')} Um alerta não comprova fraude ou perda financeira.`
        : `${selected.summary}. Evidências: ${selected.evidence.join(' ')} Verificações sugeridas: ${selected.suggestedActions.join(' ')}`;
      answer = `Resposta simulada para o pedido ${selected.orderId}: ${details} A conclusão depende da revisão de um analista. Nenhuma alteração financeira será executada.`;
    }
    setMessages(previous => [...previous, { role: 'user', text: value }, { role: 'assistant', text: answer }]); setPrompt('');
  };
  return <><Header kicker="ASSISTENTE" title="Copiloto financeiro" description="Explore uma explicação contextual dos alertas. As respostas são programadas; a IA generativa ainda não está conectada." action={<span className="tag tag-warn">Respostas simuladas</span>}/>
    <section className="panel chat-panel"><div className="chat-intro"><div className="chat-emblem" aria-hidden="true">✧</div><h2>Entenda o caso, etapa por etapa</h2><p>{bundle.source === 'demo' ? 'Contexto: dados sintéticos da demonstração.' : 'Contexto: CSV local, mantido somente nesta sessão.'}</p></div>
      {cases.length > 0 && <div className="copilot-context"><label className="field-label" htmlFor="copilot-case">Ocorrência em análise</label><select id="copilot-case" value={selected?.id ?? ''} onChange={event => setParams({ case: event.target.value })}>{!selected && <option value="">Selecione uma ocorrência</option>}{cases.map(item => <option key={item.id} value={item.id}>{item.orderId} · {CASE_NAMES[item.type]}</option>)}</select>{selected && <Link className="text-button" to={`/cases/${encodeURIComponent(selected.id)}`}>Ver evidências e registrar decisão</Link>}</div>}
      {requestedId && !selected && <p className="alert-error" role="alert">A ocorrência selecionada não existe neste conjunto. Selecione outro caso.</p>}
      <div className="prompt-grid">{['Explique a divergência deste pedido', 'Quais evidências devo verificar?', 'Quais cuidados antes de resolver o caso?'].map(text => <button type="button" key={text} disabled={!selected} onClick={() => send(text)}>{text}</button>)}</div>
      <div ref={chatRef} className="chat-messages" role="log" aria-label="Conversa simulada" aria-live="polite" aria-relevant="additions">{messages.map((message, index) => <div key={index} className={`chat-bubble ${message.role === 'user' ? 'chat-user' : 'chat-ai'}`}><b>{message.role === 'user' ? 'Você' : 'YouResolve · simulação'}</b><p>{message.text}</p></div>)}</div>
      {!cases.length && <p className="empty-state">Este conjunto não tem alertas. Importe a amostra para explorar uma investigação.</p>}
      <form className="chat-form" onSubmit={event => { event.preventDefault(); send(prompt); }}><label className="sr-only" htmlFor="chat-prompt">Pergunte ao copiloto</label><input id="chat-prompt" maxLength={2000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Pergunte sobre o caso selecionado…"/><button className="button button-primary" type="submit" disabled={!prompt.trim()}>Enviar</button></form>
      <p className="helper">Esta simulação usa somente as evidências do caso selecionado. Nenhum dado é enviado para um serviço de IA.</p>
    </section></>;
}

/** Exporta decisões da fonte ativa. CSV importado e suas decisões nunca são persistidos. */
export function AuditPage() {
  const { cases, audit, bundle } = useAppData();
  const resolved = cases.filter(item => item.status === 'resolved').length;
  const caseOrders = new Map(cases.map(item => [item.id, item.orderId]));
  const exportAudit = () => downloadCsv('youresolve-audit.csv', [['eventId', 'caseId', 'orderId', 'action', 'timestamp', 'actor', 'note'], ...audit.map(event => [event.id, event.caseId, caseOrders.get(event.caseId) ?? '', event.action, event.at, event.actor, event.note ?? ''])]);
  return <><Header kicker="RASTREABILIDADE" title="Auditoria e relatórios" description="Acompanhe decisões humanas e exporte registros. Este histórico é local e demonstrativo." action={<button className="button button-primary" type="button" disabled={!audit.length} onClick={exportAudit}>Exportar auditoria CSV</button>}/>
    <div className="stat-strip"><div><span>Eventos de auditoria</span><strong>{integer(audit.length)}</strong></div><div><span>Casos resolvidos</span><strong>{integer(resolved)}</strong></div><div><span>Casos em aberto</span><strong>{integer(cases.length - resolved)}</strong></div><div><span>Origem dos registros</span><strong className="stat-text">{bundle.source === 'demo' ? 'Demonstração' : 'CSV local'}</strong></div></div>
    <section className="panel"><h2>Trilha de decisões</h2><p className="helper">{bundle.source === 'demo' ? 'As decisões da base sintética ficam neste navegador. Restaurar a demonstração apaga esse histórico.' : 'As decisões deste CSV ficam somente em memória e serão descartadas ao recarregar a página.'} Este registro não é uma auditoria imutável de produção.</p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabela de auditoria; deslize para ver todas as colunas"><table className="data-table"><thead><tr><th scope="col">Pedido / ocorrência</th><th scope="col">Ação</th><th scope="col">Responsável</th><th scope="col">Data</th><th scope="col">Justificativa</th></tr></thead><tbody>{audit.map(event => <tr key={event.id}><td><Link to={`/cases/${encodeURIComponent(event.caseId)}`}><strong>{caseOrders.get(event.caseId) ?? event.caseId}</strong><small>{event.caseId}</small></Link></td><td>{event.action}</td><td>{event.actor}</td><td>{new Date(event.at).toLocaleString('pt-BR')}</td><td className="audit-note">{event.note || 'Sem nota adicional.'}</td></tr>)}</tbody></table></div>
      {!audit.length && <div className="empty-state"><p>Nenhuma decisão registrada.</p><Link className="text-button" to="/cases">Investigar uma ocorrência</Link></div>}
    </section></>;
}