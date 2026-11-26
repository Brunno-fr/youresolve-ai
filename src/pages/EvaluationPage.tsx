import * as React from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../app/AppContext';
import { useEvaluation } from '../app/EvaluationContext';
import { serializeCsv } from '../domain/csvExport';
import { summarizeEvaluation } from '../domain/evaluation';
import { dateLabel, integer, money, percent } from '../domain/format';
import '../styles/evaluation.css';

type Trial = ReturnType<typeof useEvaluation>['trials'][number];
type Prediction = Trial['predicted'];
const CLASSIFICATIONS: { value: Prediction; label: string }[] = [
  { value: 'NONE', label: 'Nenhum alerta nas quatro regras' },
  { value: 'COMMISSION_MISMATCH', label: 'Diferença no valor da comissão' },
  { value: 'MISSING_PAYMENT', label: 'Pagamento não localizado' },
  { value: 'REFUND_WITH_ACTIVE_COMMISSION', label: 'Comissão ativa após reembolso' },
  { value: 'DUPLICATE_PAYMENT', label: 'Mais de um registro de pagamento' },
];
const MODE_NAMES = { manual: 'Manual', assisted: 'Assistido por regras' } as const;
const ENTRY_NAMES = { payment: 'Pagamento', commission: 'Comissão', refund: 'Reembolso' } as const;
const classificationLabel = (value: Prediction) => CLASSIFICATIONS.find(option => option.value === value)?.label ?? value;
const durationLabel = (milliseconds: number | null) => milliseconds === null ? 'Ainda sem medição' : `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(milliseconds / 1000)} s`;
const signedSeconds = (milliseconds: number | null) => milliseconds === null ? 'Sem pares completos' : `${milliseconds > 0 ? '+' : ''}${durationLabel(milliseconds)}`;

/** Relógio apenas visual; a duração registrada vem de performance.now no provider. */
function useElapsed(startedAt: number | null): number {
  const [now, setNow] = React.useState(() => performance.now());
  React.useEffect(() => {
    if (startedAt === null) return;
    setNow(performance.now());
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}

/** Exporta somente respostas realmente registradas; não inclui nomes nem dados pessoais. */
function exportTrials(trials: readonly Trial[], complete: boolean) {
  const headers = ['sessionId', 'variant', 'taskId', 'pairId', 'orderId', 'mode', 'predicted', ...(complete ? ['expected', 'correct'] : []), 'elapsedMs', 'completedAt'];
  const rows = trials.map(trial => [trial.sessionId, trial.variant, trial.taskId, trial.pairId, trial.orderId, trial.mode, trial.predicted, ...(complete ? [trial.expected, String(trial.correct)] : []), String(trial.elapsedMs), trial.completedAt]);
  const url = URL.createObjectURL(new Blob([serializeCsv([headers, ...rows])], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `youresolve-avaliacao-${complete ? 'completa' : 'parcial'}-${trials[0].sessionId}.csv`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ensaio descritivo em dados sintéticos, independente de decisões financeiras e sem IA real. */
export function EvaluationPage() {
  const { bundle } = useAppData();
  const evaluation = useEvaluation();
  const { task, taskIndex, taskCount, phase, trials, feedback, startedAt, error, variant, prediction } = evaluation;
  const [exportNotice, setExportNotice] = React.useState('');
  const feedbackRef = React.useRef<HTMLHeadingElement>(null);
  const stageRef = React.useRef<HTMLHeadingElement>(null);
  const elapsed = useElapsed(startedAt);
  const summary = React.useMemo(() => summarizeEvaluation([...trials]), [trials]);
  const completedAll = taskCount > 0 && trials.length === taskCount;
  React.useEffect(() => { setExportNotice(''); }, [task?.id, evaluation.sessionId]);
  React.useEffect(() => {
    if (phase === 'feedback') feedbackRef.current?.focus();
    if (phase === 'complete') stageRef.current?.focus();
  }, [phase]);
  const exportCurrent = () => {
    exportTrials(trials, completedAll);
    setExportNotice(`${completedAll ? 'Ensaio completo' : 'Ensaio parcial'} exportado com ${integer(trials.length)} respostas registradas.`);
  };
  const restart = () => { evaluation.restart(); setExportNotice(''); };

  return <div className="evaluation-page">
    <header className="page-header"><div><span className="overline">AVALIAÇÃO DO PROTÓTIPO</span><h1>Manual ou assistido?</h1><p>Observe tempo e classificação em uma sequência de tarefas sintéticas. A assistência usa regras verificáveis, sem IA generativa.</p></div><span className="tag tag-green">Ensaio local</span></header>
    {!evaluation.available ? <section className="panel evaluation-unavailable"><h2>Use a base de demonstração</h2><p>{bundle.source === 'upload' ? 'O ensaio não utiliza CSVs importados. Para começar, acesse Conciliação e restaure a demonstração.' : error || 'Não foi possível montar as tarefas pareadas deste conjunto.'}</p><p className="helper">Trocar a base limpa o ensaio. As decisões dos casos não são alteradas pela avaliação.</p><Link className="button button-subtle" to="/reconciliation">Ir para conciliação</Link></section> : <>
      <section className="panel evaluation-intro" aria-labelledby="evaluation-method-title"><div><h2 id="evaluation-method-title">Como funciona</h2><p>São {taskCount} tarefas: cinco pares com dois pedidos diferentes por categoria, incluindo um cenário sem alerta. Em cada par, você analisa um pedido manualmente e outro com evidências calculadas.</p><p className="helper">No modo manual, consulte os registros brutos. No assistido, consulte também as evidências das regras. Classifique o pedido em uma das cinco opções, sem alterar valores ou decisões dos casos.</p></div><div className="evaluation-method-note"><span className="tag">Sequência {variant}</span><p>O relógio começa em <strong>Iniciar tarefa</strong> e termina em <strong>Registrar resposta</strong>. Pausas e saídas desta página entram no tempo.</p><p className="helper">O ensaio fica somente em memória. Recarregar ou trocar a base descarta as respostas. A sequência A/B alterna os modos entre pedidos pareados.</p></div></section>
      <section className="evaluation-progress" aria-label="Progresso do ensaio"><div><strong>{trials.length} de {taskCount} respostas</strong><span>{completedAll ? 'Todas as tarefas respondidas' : trials.length ? 'Ensaio incompleto' : 'Nenhuma medição coletada'}</span></div><progress value={trials.length} max={taskCount} aria-label={`${trials.length} de ${taskCount} respostas registradas`}/></section>
      {task && phase !== 'complete' && <section className="panel evaluation-stage" aria-labelledby="evaluation-stage-title">
        <div className="evaluation-stage-heading"><div><span className="overline">TAREFA {taskIndex + 1} DE {taskCount}</span><h2 id="evaluation-stage-title">{MODE_NAMES[task.mode]}</h2></div><span className={`tag ${task.mode === 'assisted' ? 'tag-green' : ''}`}>{task.mode === 'manual' ? 'Somente registros' : 'Registros e evidências'}</span></div>
        {phase === 'ready' ? <div className="evaluation-ready"><h3>Comece quando estiver pronto</h3><p>Os dados do pedido só aparecem depois de iniciar. Escolha um momento em que possa concluir a tarefa sem interrupções.</p><button className="button button-primary" type="button" onClick={evaluation.startTask}>Iniciar tarefa</button></div> : <>
          <div className="evaluation-clock"><span>{phase === 'running' ? 'Tempo desde o início' : 'Tempo registrado'}</span><strong aria-live="off">{durationLabel(phase === 'running' ? elapsed : feedback?.elapsedMs ?? 0)}</strong><small>{phase === 'running' ? 'Inclui pausas e navegação' : 'A resposta e o tempo estão congelados'}</small></div>
          <div className="evaluation-task-grid"><div><h3>Pedido {task.order.id}</h3><dl className="evaluation-order"><div><dt>Data</dt><dd>{dateLabel(task.order.date)}</dd></div><div><dt>Valor bruto</dt><dd>{money(task.order.grossCents)}</dd></div><div><dt>Status registrado</dt><dd>{task.order.status === 'approved' ? 'Aprovado' : 'Reembolsado'}</dd></div><div><dt>Taxa de comissão</dt><dd>{percent(task.order.commissionRateBps / 100, 2)}</dd></div><div><dt>Creator</dt><dd>{task.order.creatorId}</dd></div></dl>
            <h3>Lançamentos associados</h3><div className="table-wrap" tabIndex={0} role="region" aria-label="Lançamentos do pedido"><table className="data-table evaluation-ledger"><thead><tr><th scope="col">Registro</th><th scope="col">Tipo</th><th scope="col">Valor</th><th scope="col">Data</th></tr></thead><tbody>{[...task.ledger].sort((left, right) => left.at.localeCompare(right.at)).map(entry => <tr key={entry.id}><td>{entry.id}</td><td>{ENTRY_NAMES[entry.kind]}</td><td>{money(entry.amountCents)}</td><td>{dateLabel(entry.at)}</td></tr>)}</tbody></table>{!task.ledger.length && <p className="empty-state">Nenhum lançamento associado a este pedido.</p>}</div>
          </div>{task.mode === 'assisted' && <aside className="evaluation-assistance" aria-labelledby="evaluation-evidence-title"><span className="tag tag-green">Regras, sem IA</span><h3 id="evaluation-evidence-title">Evidências calculadas</h3>{task.evidence.length ? <ul>{task.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul> : <p>As quatro regras não identificaram alertas neste pedido.</p>}{task.suggestedActions.length > 0 && <><h4>Verificações sugeridas</h4><ul>{task.suggestedActions.map((action, index) => <li key={index}>{action}</li>)}</ul></>}<p className="helper">Um alerta é uma hipótese de investigação. Não comprova fraude nem perda financeira.</p></aside>}</div>
          {phase === 'running' && <form className="evaluation-answer" onSubmit={event => { event.preventDefault(); evaluation.submitAnswer(prediction); }}><fieldset aria-describedby="evaluation-answer-help"><legend>Qual é a classificação deste pedido?</legend><p id="evaluation-answer-help" className="helper">Considere somente as quatro regras do protótipo. Escolha a opção mais adequada aos registros.</p><div className="evaluation-choices">{CLASSIFICATIONS.map(option => <label key={option.value} className={`evaluation-choice ${prediction === option.value ? 'evaluation-choice-selected' : ''}`}><input type="radio" name="evaluation-prediction" value={option.value} checked={prediction === option.value} onChange={() => evaluation.choosePrediction(option.value)}/><span>{option.label}</span></label>)}</div></fieldset>{error && <p className="alert-error" role="alert">{error}</p>}<button className="button button-primary" type="submit">Registrar resposta</button><p className="helper">Depois de registrar, a resposta e o tempo desta tarefa não podem ser alterados.</p></form>}
          {phase === 'feedback' && feedback && <div className="evaluation-feedback"><h3 ref={feedbackRef} tabIndex={-1}>Resposta registrada</h3><p role="status">Sua classificação foi salva: <strong>{classificationLabel(feedback.predicted)}</strong>. Tempo: {durationLabel(feedback.elapsedMs)}.</p><p className="helper">O gabarito e os acertos aparecem ao encerrar as tarefas, para reduzir a influência nas próximas respostas.</p><button className="button button-primary" type="button" onClick={evaluation.nextTask}>{completedAll ? 'Ver resultados' : 'Próxima tarefa'}</button></div>}
        </>}
      </section>}
      {phase === 'complete' && <section className="panel evaluation-results" aria-labelledby="evaluation-results-title"><div className="panel-title"><h2 ref={stageRef} id="evaluation-results-title" tabIndex={-1}>Resultados deste ensaio</h2><span className="tag tag-green">{trials.length} respostas registradas</span></div><p>As medidas abaixo descrevem somente esta sessão. Não demonstram ganho de produtividade ou eficácia de IA.</p>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Resultados por modo"><table className="data-table evaluation-summary"><thead><tr><th scope="col">Modo</th><th scope="col">Tarefas</th><th scope="col">Acertos</th><th scope="col">Acurácia</th><th scope="col">Tempo mediano</th></tr></thead><tbody>{(['manual', 'assisted'] as const).map(mode => <tr key={mode}><th scope="row">{MODE_NAMES[mode]}</th><td>{summary.modes[mode].count}</td><td>{summary.modes[mode].correct}</td><td>{summary.modes[mode].accuracy === null ? 'Sem respostas' : percent(summary.modes[mode].accuracy * 100)}</td><td>{durationLabel(summary.modes[mode].medianElapsedMs)}</td></tr>)}</tbody></table></div>
        <div className="evaluation-error-breakdown"><h3>Tipos de erro, com os denominadores</h3><div className="table-wrap" tabIndex={0} role="region" aria-label="Erros por modo"><table className="data-table"><thead><tr><th scope="col">Modo</th><th scope="col">Falsos positivos</th><th scope="col">Falsos negativos</th><th scope="col">Categoria incorreta</th></tr></thead><tbody>{(['manual', 'assisted'] as const).map(mode => <tr key={mode}><th scope="row">{MODE_NAMES[mode]}</th><td>{summary.modes[mode].falsePositives} de {summary.modes[mode].negativeCount} pedidos sem alerta{summary.modes[mode].falsePositiveRate !== null && <small>{percent(summary.modes[mode].falsePositiveRate * 100)} desta amostra</small>}</td><td>{summary.modes[mode].falseNegatives} de {summary.modes[mode].positiveCount} pedidos com alerta</td><td>{summary.modes[mode].wrongCategories} de {summary.modes[mode].positiveCount} pedidos com alerta</td></tr>)}</tbody></table></div><p className="helper">Falso positivo: você marcou alerta em um pedido sem alerta. Falso negativo: marcou nenhum alerta em um pedido com alerta. Categoria incorreta: identificou um alerta, mas escolheu outro tipo.</p></div>
        <div className="evaluation-paired"><h3>Comparação dos pares completos</h3><p>{summary.paired.count} pares com uma resposta em cada modo, na mesma sessão e variante.</p><dl><div><dt>Diferença mediana de tempo</dt><dd>{signedSeconds(summary.paired.medianTimeDifferenceMs)}</dd></div><div><dt>Diferença de acurácia</dt><dd>{summary.paired.accuracyDifference === null ? 'Sem pares completos' : `${summary.paired.accuracyDifference > 0 ? '+' : ''}${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(summary.paired.accuracyDifference * 100)} pontos percentuais`}</dd></div></dl><p className="helper">Diferença = assistido menos manual. No tempo, um valor negativo significa menor duração no assistido. A leitura deve considerar os acertos, as pausas e a pequena amostra.</p></div>
        <details className="evaluation-responses"><summary>Conferir respostas e gabarito</summary><div className="table-wrap" tabIndex={0} role="region" aria-label="Respostas individuais"><table className="data-table"><thead><tr><th scope="col">Pedido</th><th scope="col">Modo</th><th scope="col">Sua resposta</th><th scope="col">Esperado</th><th scope="col">Resultado</th><th scope="col">Tempo</th></tr></thead><tbody>{trials.map(trial => <tr key={trial.taskId}><td>{trial.orderId}</td><td>{MODE_NAMES[trial.mode]}</td><td>{classificationLabel(trial.predicted)}</td><td>{classificationLabel(trial.expected)}</td><td><span className={trial.correct ? 'evaluation-correct' : 'evaluation-incorrect'}>{trial.correct ? 'Acerto' : 'Erro'}</span></td><td>{durationLabel(trial.elapsedMs)}</td></tr>)}</tbody></table></div></details>
      </section>}
      {trials.length > 0 && <section className="panel evaluation-export" aria-labelledby="evaluation-export-title"><h2 id="evaluation-export-title">Guardar os registros</h2><p>{completedAll ? 'O ensaio tem todas as respostas registradas.' : `Ensaio incompleto: ${trials.length} de ${taskCount} respostas. A exportação contém apenas as tarefas concluídas.`} O CSV inclui identificadores anônimos da sessão, modos, respostas, tempos e horários. {completedAll ? 'A versão completa também inclui gabarito e acerto por tarefa.' : 'A versão parcial omite o gabarito e os acertos.'}</p><button className="button button-subtle" type="button" onClick={exportCurrent}>{completedAll ? 'Exportar ensaio completo CSV' : 'Exportar ensaio parcial CSV'}</button><p className="helper">O gabarito só é incluído depois que todas as tarefas forem respondidas.</p>{exportNotice && <p className="alert-success" role="status">{exportNotice}</p>}</section>}
      <section className="panel evaluation-limitations"><h2>Como interpretar</h2><p>Esta é uma comparação exploratória com dez pedidos fictícios. O tempo inclui leitura, decisão e eventuais interrupções; não mede uma operação financeira real. Experiência prévia, ordem e familiaridade com os exemplos influenciam o resultado.</p><p>Para outra pessoa, inicie um novo ensaio: a sequência muda de {variant} para {variant === 'A' ? 'B' : 'A'}. Repetir as tarefas com a mesma pessoa pode gerar aprendizado. As decisões dos casos permanecem intactas.</p><button className="button button-subtle" type="button" onClick={restart}>Novo ensaio</button><p className="helper">O novo ensaio descarta as respostas atuais. Exporte o CSV antes, caso queira guardá-las.</p></section>
    </>}
  </div>;
}