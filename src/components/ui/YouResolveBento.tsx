import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { dateLabel, integer, percent } from '../../domain/format';
import { buildCaseTimeline, buildDailyAlerts, buildOrderHistogram } from '../../domain/analytics';
import type { AuditEvent, DataBundle, InvestigationCase, ReconciliationSummary } from '../../domain/types';

interface Props { bundle: DataBundle; summary: ReconciliationSummary; cases: InvestigationCase[]; audit: AuditEvent[] }
const TYPES = [
  { key: 'COMMISSION_MISMATCH', label: 'Comissões', color: '#27E49A' },
  { key: 'REFUND_WITH_ACTIVE_COMMISSION', label: 'Reembolsos', color: '#B49BFA' },
  { key: 'MISSING_PAYMENT', label: 'Pagamentos ausentes', color: '#E6AE75' },
  { key: 'DUPLICATE_PAYMENT', label: 'Duplicações', color: '#8BB6D5' },
] as const;
const bySeverity = (a: InvestigationCase, b: InvestigationCase) => Number(b.severity === 'critical') - Number(a.severity === 'critical');

/** Card base: componentes semanticamente independentes no layout Bento responsivo. */
function Tile({ title, area, action, children }: {title: string; area: string; action?: React.ReactNode; children: React.ReactNode}) {
  return <section className={`yrb-tile yrb-${area}`} aria-label={title}>
    <div className="yrb-head"><h3>{title}</h3>{action}</div>{children}
  </section>;
}

/** Resumo diário derivado das datas do conjunto; barras também respondem ao foco de teclado. */
function Hero({bundle, summary, cases}: {bundle: DataBundle; summary: ReconciliationSummary; cases: InvestigationCase[]}) {
  const [hover, setHover] = React.useState<string | null>(null);
  const days = React.useMemo(() => buildDailyAlerts(bundle, cases), [bundle, cases]);
  const selectedDay = days.find(day => day.date === hover);
  const max = Math.max(1, ...days.map(day => day.count));
  return <Tile title="Visão de conciliação" area="hero" action={<span className="yrb-chip">{bundle.source === 'demo' ? 'Demonstração' : 'Conjunto importado'}</span>}>
    <div className="yrb-hero-title">Olá, <span>analista.</span></div>
    <p className="yrb-muted">Uma visão clara dos registros que merecem investigação.</p>
    <div className="yrb-hero-number">{integer(summary.clean)} <small>de {integer(summary.examined)} pedidos sem alertas</small></div>
    <p className="yrb-trend">{percent(summary.rate)} sem alertas nas regras avaliadas</p>
    {days.length > 0 ? <>
      <div className="yrb-bars" role="group" aria-label="Alertas por dia do conjunto, até 30 dias">
        {days.map(day => <button key={day.date} type="button" title={`${day.date}: ${day.count} alertas`}
          onPointerEnter={() => setHover(day.date)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(day.date)} onBlur={() => setHover(null)}
          aria-label={`${day.date}: ${day.count} alertas`}
          style={{height: `${Math.max(4, (day.count / max) * 100)}%`, background: day.count > 2 ? '#B49BFA' : '#27E49A', opacity: hover === null ? .45 + (day.count / max) * .5 : hover === day.date ? 1 : .25}} />)}
      </div>
      <div className="yrb-axis"><span>{dateLabel(days[0].date)}</span><span>{selectedDay ? `${dateLabel(selectedDay.date)} · ${selectedDay.count} alertas` : 'Alertas por dia'}</span><span>{dateLabel(days[days.length - 1].date)}</span></div>
      <p className="yrb-fine">Período dos registros: {days[0].date} a {days[days.length - 1].date}.</p>
    </> : <p className="yrb-empty">Carregue um conjunto para visualizar os alertas por dia.</p>}
  </Tile>;
}
/** Pilha interativa de ocorrências prioritárias, substitui os cartões bancários do Bento original. */
function PriorityStack({cases}:{cases: InvestigationCase[]}) {
  const navigate=useNavigate();
  const top = React.useMemo(()=>[...cases].filter(c=>c.status!=='resolved').sort(bySeverity).slice(0,3),[cases]);
  const [selected,setSelected]=React.useState<string | null>(null);
  const current = top.find(item => item.id === selected) ?? top[0];
  return <Tile title="Fila prioritária" area="priority" action={<span className="yrb-chip">{top.length} casos</span>}>
    <div className="yrb-stack">{!top.length && <p className="yrb-empty">Todas as ocorrências foram tratadas.</p>}
      {top.map((c,i) => <button key={c.id} type="button" onClick={()=>setSelected(c.id)}
        className={`yrb-stack-card ${c.id===current?.id?'yrb-stack-card-active':''}`}
        style={{top: i*24+6, zIndex:c.id===current?.id?8:3-i, background:['linear-gradient(135deg,#b79ffa,#7350ad)','linear-gradient(135deg,#e4b678,#986637)','linear-gradient(135deg,#36ecaa,#14764d)'][i]}}
        aria-pressed={c.id===current?.id} aria-label={`Selecionar ocorrência ${c.orderId}`}>
        <strong>{c.orderId}</strong><small>{c.severity==='critical'?'CRÍTICO':'ATENÇÃO'}</small>
      </button>)}
    </div>
    <div className="yrb-stack-footer">
      <span>{current?.summary ?? 'Nenhuma pendência'}</span>
      <button type="button" disabled={!current} onClick={()=>navigate(`/cases/${encodeURIComponent(current.id)}`)} className="yrb-link">Investigar</button>
    </div>
  </Tile>;
}

/** Velocímetro baseado na proporção exata de pedidos sem alertas. */
function RateGauge({rate, examined}:{rate:number;examined:number}) {
  const r=61, len=Math.PI*r;
  return <Tile title="Índice de conciliação" area="gauge" action={<span className="yrb-status">● Verificado</span>}>
    <div className="yrb-gauge-svg"><svg viewBox="0 0 160 90" role="img" aria-label={`Índice de conciliação: ${percent(rate)}`}>
      <path d="M 19 77 A 61 61 0 0 1 141 77" stroke="#2D4237" strokeWidth="11" fill="none" strokeLinecap="round"/>
      <path d="M 19 77 A 61 61 0 0 1 141 77" stroke="#27E49A" strokeWidth="11" fill="none" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len*(1-rate/100)} className="yrb-gauge-fill"/>
      <line x1="80" y1="77" x2="80" y2="31" stroke="#e4f4e9" strokeWidth="2.5" strokeLinecap="round" style={{transform:`rotate(${-90+rate*1.8}deg)`,transformOrigin:'80px 77px'}} />
      <circle cx="80" cy="77" r="4" fill="#f4fff9"/>
    </svg></div>
    <div className="yrb-gauge-value">{percent(rate)}</div>
    <p className="yrb-muted yrb-centered">{integer(examined)} pedidos verificados</p>
  </Tile>;
}

/** Curvas derivadas da auditoria: decisões são mostradas no dia em que foram registradas. */
function CaseChart({bundle, cases, audit}: {bundle: DataBundle; cases: InvestigationCase[]; audit: AuditEvent[]}) {
  const [range, setRange] = React.useState<7 | 30 | 90>(30);
  const [hover, setHover] = React.useState<number | null>(null);
  const sliderId = React.useId();
  const gradientId = React.useId();
  const data = React.useMemo(() => buildCaseTimeline(bundle, cases, audit, range), [bundle, cases, audit, range]);
  const filters = <div className="yrb-pills" role="group" aria-label="Período do gráfico">{([7, 30, 90] as const).map(n => <button key={n} type="button" aria-pressed={n === range} onClick={() => { setRange(n); setHover(null); }}>{n}D</button>)}</div>;
  if (!data.length) return <Tile title="Evolução de casos" area="chart" action={filters}><p className="yrb-empty">Sem registros para exibir neste conjunto.</p></Tile>;
  const max = Math.max(1, ...data.map(point => point.opened));
  const width = 540, height = 200, margin = 12;
  const coords = (kind: 'opened' | 'resolved') => data.map((point, index) => `${index === 0 ? 'M' : 'L'} ${(index / (data.length - 1)) * width} ${height - margin - (point[kind] / max) * (height - 32)}`).join(' ');
  const index = Math.min(hover ?? data.length - 1, data.length - 1);
  const point = data[index];
  return <Tile title="Evolução de casos" area="chart" action={filters}>
    <div className="yrb-chart-figs"><div><span className="yrb-key"><i style={{background: '#27E49A'}}/> Casos detectados</span><strong>{integer(point.opened)}</strong></div><div><span className="yrb-key"><i style={{background: '#B49BFA'}}/> Casos resolvidos</span><strong>{integer(point.resolved)}</strong></div></div>
    <div className="yrb-plot" onPointerLeave={() => setHover(null)} onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); setHover(Math.min(data.length - 1, Math.max(0, Math.round(((event.clientX - box.left) / box.width) * (data.length - 1))))); }}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Em ${point.date}: ${point.opened} casos detectados e ${point.resolved} resolvidos`}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#27E49A" stopOpacity=".24"/><stop offset="1" stopColor="#27E49A" stopOpacity="0"/></linearGradient></defs>
        {[.25, .5, .75].map(value => <line key={value} x1="0" x2={width} y1={height * value} y2={height * value} stroke="#33473b" strokeDasharray="3 6"/>)}
        <path d={`${coords('opened')} L ${width} ${height} L 0 ${height} Z`} fill={`url(#${gradientId})`}/>
        <path d={coords('opened')} fill="none" stroke="#27E49A" strokeWidth="3" vectorEffect="non-scaling-stroke"/>
        <path d={coords('resolved')} fill="none" stroke="#B49BFA" strokeWidth="2" strokeDasharray="6 7" vectorEffect="non-scaling-stroke"/>
        {hover !== null && <line x1={index / (data.length - 1) * width} x2={index / (data.length - 1) * width} y1="0" y2={height} stroke="#dae9df" opacity=".6" strokeDasharray="3 4"/>}
      </svg>
    </div>
    <div className="yrb-axis"><span>{dateLabel(data[0].date)}</span><span>{point.date}</span><span>{dateLabel(data[data.length - 1].date)}</span></div>
    <label className="yrb-chart-control" htmlFor={sliderId}>Explorar dia do gráfico
      <input id={sliderId} type="range" min="0" max={data.length - 1} value={index} onChange={event => setHover(Number(event.target.value))}
        aria-valuetext={`${point.date}: ${point.opened} detectados, ${point.resolved} resolvidos`}/>
    </label>
    <p className="yrb-fine">Estado ao fim de cada dia (UTC). Resoluções e reaberturas seguem a data da decisão.</p>
  </Tile>;
}
/** Distribuição de alertas pelo tipo, não por moedas ou ativos. */
function TypesTile({cases}:{cases:InvestigationCase[]}) {
  const nav=useNavigate();const total=Math.max(1,cases.length);
  return <Tile title="Tipos de divergência" area="types">
    <div className="yrb-big-number">{integer(cases.length)} <small>eventos</small></div>
    <div className="yrb-segments">{TYPES.map(t=>{const n=cases.filter(c=>c.type===t.key).length;return <span key={t.key} title={`${t.label}: ${n}`} style={{width:`${100*n/total}%`,background:t.color}}/>})}</div>
    <div className="yrb-types-list">{TYPES.map(t=>{const n=cases.filter(c=>c.type===t.key).length;return <button key={t.key} type="button" onClick={()=>nav(`/cases?type=${t.key}`)}><span><i style={{background:t.color}}/>{t.label}</span><b>{n}</b></button>})}</div>
  </Tile>;
}

/** Tile destacada: a IA apenas explica evidências, sem aprovar repasses. */
function AITile({cases}:{cases:InvestigationCase[]}) {
  const navigate=useNavigate();
  const c=cases.find(k=>k.status!=='resolved'&&k.severity==='critical')??cases.find(k=>k.status!=='resolved');
  return <section className="yrb-ai" aria-label="Diagnóstico inteligente"><div className="yrb-ai-head"><h3>✧ Diagnóstico inteligente</h3><span>simulação</span></div>
    <strong className="yrb-ai-number">{cases.filter(k=>k.status!=='resolved'&&k.severity==='critical').length}</strong>
    <p className="yrb-ai-label">alertas críticos em aberto</p>
    <div className="yrb-ai-rule"/>
    <h4>{c?'Verificação recomendada':'Nenhum alerta crítico'}</h4>
    <p>{c?.summary??'Sem ocorrência crítica pendente no cenário atual.'}</p>
    <p className="yrb-ai-caveat">Simulação sem IA conectada. As regras sugerem verificações; o analista decide.</p>
    <button type="button" onClick={()=>navigate(c?`/cases/${encodeURIComponent(c.id)}`:'/copilot')}>{c?'Investigar ocorrência':'Abrir copiloto'}</button>
  </section>;
}

/** Meta operacional parametrizável; ausência de base temporal não vira métrica inventada. */
function SlaTile({cases}:{cases:InvestigationCase[]}) {
  const [target,setTarget]=React.useState(2);
  const pending=cases.filter(c=>c.status!=='resolved').length;
  return <Tile title="Triagem e SLA" area="sla" action={<span className="yrb-chip">meta simulada</span>}>
    <div className="yrb-sla-row"><strong>{integer(pending)}</strong><span>pendências para triagem</span></div>
    <p className="yrb-muted">Meta de início da análise: {target} horas (hipótese).</p>
    <div className="yrb-pills yrb-sla-pills">{[1,2,4].map(n=><button key={n} type="button" aria-pressed={target===n} onClick={()=>setTarget(n)}>{n}h</button>)}</div>
    <p className="yrb-fine">Tempo real não mensurado neste conjunto sintético.</p>
  </Tile>;
}

/** Histograma de até 30 intervalos: conserva todos os pedidos sem criar milhares de barras. */
function BatchTile({bundle}: {bundle: DataBundle}) {
  const navigate = useNavigate();
  const [active, setActive] = React.useState<string | null>(null);
  const buckets = React.useMemo(() => buildOrderHistogram(bundle), [bundle]);
  const max = Math.max(1, ...buckets.map(bucket => bucket.count));
  const selected = buckets.find(bucket => bucket.start === active);
  const label = (bucket: typeof buckets[number]) => `${bucket.start}${bucket.end === bucket.start ? '' : ` a ${bucket.end}`}: ${bucket.count} pedidos`;
  return <Tile title="Processamento de registros" area="batches" action={<button type="button" className="yrb-link" onClick={() => navigate('/reconciliation')}>Importar CSV</button>}>
    <div className="yrb-batch-summary"><strong>{integer(bundle.orders.length)}</strong><span>pedidos no conjunto {bundle.source === 'demo' ? 'de demonstração' : 'importado'}</span></div>
    {buckets.length ? <>
      <div className="yrb-batch-bars" role="group" aria-label="Pedidos por período">{buckets.map(bucket => <button key={bucket.start} type="button" title={label(bucket)} aria-label={label(bucket)}
        onFocus={() => setActive(bucket.start)} onBlur={() => setActive(null)} onPointerEnter={() => setActive(bucket.start)} onPointerLeave={() => setActive(null)}
        style={{height: `${Math.max(4, 100 * bucket.count / max)}%`}}/>)}</div>
      <p className="yrb-fine">{selected ? label(selected) : `${buckets[0].start} a ${buckets[buckets.length - 1].end} · ${buckets.length} intervalos`}</p>
    </> : <p className="yrb-empty">Nenhum pedido carregado.</p>}
    <p className="yrb-fine">Volume dos registros carregados, sem atualização em tempo real.</p>
  </Tile>;
}
/** Histórico sintetiza eventos registrados em memória/localStorage e alertas de demonstração. */
function ActivityTile({cases,audit}:{cases:InvestigationCase[];audit:AuditEvent[]}) {
  const nav=useNavigate();
  const rows=audit.length?audit.slice(0,4).map(a=>({id:a.caseId,title:a.action,sub:`${a.actor} · ${new Date(a.at).toLocaleString('pt-BR')}`,positive:true})):cases.slice(0,4).map(c=>({id:c.id,title:c.summary,sub:c.orderId,positive:false}));
  return <Tile title="Atividade recente" area="activity" action={<span className="yrb-chip">auditoria</span>}>
    <div className="yrb-activity-list">{!rows.length && <p className="yrb-empty">Nenhuma ocorrência ou decisão registrada.</p>}{rows.map((a,i)=><button key={`${a.id}-${i}`} type="button" onClick={()=>nav(`/cases/${encodeURIComponent(a.id)}`)}><span className="yrb-activity-icon">{a.positive?'✓':'!'}</span><span><strong>{a.title}</strong><small>{a.sub}</small></span></button>)}</div>
  </Tile>;
}

/**
 * Dashboard Bento de nove cartões, renderizado a partir da mesma fonte de dados das demais páginas.
 * Adaptativo por container queries: 4 colunas >=1024px, 2 >=640px, 1 abaixo.
 */
export function YouResolveBento({bundle,summary,cases,audit}:Props) {
  return <div className="yrb" data-source={bundle.source}>
    <style>{BENTO_CSS}</style>
    <div className="yrb-banner"><div><span className="yrb-small-overline">FINANCIAL INTELLIGENCE</span><h1>Central operacional</h1><p>Encontre divergências. Entenda evidências. Resolva com segurança.</p></div><span className="yrb-demo-tag">● {bundle.source==='demo'?'Dados fictícios':'Dados locais importados'}</span></div>
    <div className="yrb-grid">
      <Hero bundle={bundle} summary={summary} cases={cases}/>
      <PriorityStack cases={cases}/>
      <RateGauge rate={summary.rate} examined={summary.examined}/>
      <CaseChart bundle={bundle} cases={cases} audit={audit}/>
      <TypesTile cases={cases}/>
      <AITile cases={cases}/>
      <SlaTile cases={cases}/>
      <BatchTile bundle={bundle}/>
      <ActivityTile cases={cases} audit={audit}/>
    </div>
  </div>;
}

const BENTO_CSS = `
.yrb {--yrb-bg:#0B1110;--yrb-fg:#F4FFF9;--yrb-card:#15201E;--yrb-muted:#A1B4AB;--yrb-accent:#27E49A;--yrb-lilac:#B49BFA;--yrb-border:#2D4136;container:yrb/inline-size;color:var(--yrb-fg);font-family:Inter,Geist,system-ui,sans-serif;max-width:1220px;margin:0 auto}
.yrb *,.yrb *::before,.yrb *::after{box-sizing:border-box}.yrb button{font:inherit;cursor:pointer}.yrb button:disabled{cursor:not-allowed;opacity:.6}.yrb button:focus-visible{outline:2px solid var(--yrb-accent);outline-offset:3px}.yrb-banner{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:23px}.yrb-banner h1{font-size:clamp(23px,3vw,32px);font-weight:730;letter-spacing:-.035em;margin:4px 0}.yrb-banner p{margin:0;color:#A1B4AB;font-size:1rem;line-height:1.5}.yrb-small-overline{font-size:.875rem;letter-spacing:.25em;color:#43d99f}.yrb-demo-tag,.yrb-chip{white-space:nowrap;border:1px solid #345040;color:#c4e2d0;background:#20342a;border-radius:40px;font-size:.875rem;padding:5px 9px}.yrb-demo-tag{padding:9px 12px}
.yrb-grid{display:grid;gap:12px;grid-template-columns:minmax(0,1fr);grid-template-areas:'hero' 'priority' 'gauge' 'chart' 'types' 'ai' 'sla' 'batches' 'activity'}.yrb-tile,.yrb-ai{position:relative;min-width:0;overflow:hidden;border:1px solid var(--yrb-border);border-radius:26px;background:var(--yrb-card);padding:18px;box-shadow:0 6px 26px rgba(0,0,0,.12)}.yrb-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:13px}.yrb-head h3,.yrb-ai-head h3{margin:0;font-size:.875rem;font-weight:640;letter-spacing:.01em}.yrb-link{color:#78edb8;background:transparent;border:none;font-size:.875rem;font-weight:660;padding:3px}.yrb-link:hover{text-decoration:underline}.yrb-muted{color:#A1B4AB;font-size:1rem;line-height:1.5;margin:4px 0}.yrb-centered{text-align:center}.yrb-fine{color:#A1B4AB;font-size:.8125rem;line-height:1.5;margin:12px 0 0}.yrb-small{font-size:.875rem;color:var(--yrb-muted)}
.yrb-hero{grid-area:hero;min-height:251px}.yrb-hero-title{font-size:25px;letter-spacing:-.045em;font-weight:700}.yrb-hero-title span{color:var(--yrb-accent)}.yrb-hero-number{font-size:37px;font-weight:760;letter-spacing:-.05em;margin-top:14px;line-height:1.1}.yrb-hero-number small{font-size:.875rem;font-weight:400;letter-spacing:0;color:#9db3a4}.yrb-trend{color:#63e3a6;font-size:.875rem;margin:6px 0 12px}.yrb-bars{display:flex;align-items:end;height:58px;gap:4px}.yrb-bars button{border:0;padding:0;flex:1;min-width:0;border-radius:3px 3px 0 0;transition:height .6s cubic-bezier(.22,1,.36,1),opacity .25s}.yrb-axis{display:flex;justify-content:space-between;flex-wrap:wrap;color:#A1B4AB;font-size:.875rem;margin-top:8px;gap:12px}
.yrb-priority{grid-area:priority;min-height:251px}.yrb-stack{height:133px;position:relative}.yrb-stack-card{position:absolute;left:50%;width:min(90%,225px);height:82px;border:1px solid #ffffff33;border-radius:12px;box-shadow:0 10px 30px #0006;display:flex;justify-content:space-between;align-items:flex-start;flex-direction:column;gap:4px;padding:13px;transform:translateX(-50%) scale(.93);transition:transform .55s cubic-bezier(.34,1.5,.65,1),box-shadow .25s,top .55s}.yrb-stack-card-active{transform:translateX(-50%) scale(1);box-shadow:0 14px 36px #0008}.yrb-stack-card strong{font-size:.875rem;color:#10251b}.yrb-stack-card small{color:#15261d;font-size:.875rem;font-weight:760}.yrb-stack-footer{background:#1b3027;border-radius:11px;padding:10px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px}.yrb-stack-footer span{min-width:0;color:#d2e4d8;font-size:.875rem;line-height:1.4;overflow-wrap:anywhere}
.yrb-gauge{grid-area:gauge;min-height:251px}.yrb-status{font-size:.875rem;color:#67e6a9}.yrb-gauge-svg{max-width:170px;margin:30px auto 0}.yrb-gauge-svg svg{width:100%}.yrb-gauge-fill{transition:stroke-dashoffset 1s cubic-bezier(.22,1,.36,1)}.yrb-gauge-value{text-align:center;font-weight:770;font-size:34px;letter-spacing:-.05em;margin-top:-7px}.yrb-gauge p{margin-top:3px}
.yrb-chart{grid-area:chart;min-height:365px}.yrb-pills{display:inline-flex;background:#22332a;border-radius:30px;padding:3px;gap:2px}.yrb-pills button{border:0;background:transparent;color:#91ab9c;font-size:.875rem;padding:5px 9px;border-radius:20px}.yrb-pills button[aria-pressed="true"]{background:#e4f5e9;color:#123022;font-weight:700}.yrb-chart-figs{display:flex;gap:28px;flex-wrap:wrap;margin:15px 0 6px}.yrb-chart-figs>div{display:flex;flex-direction:column;gap:4px}.yrb-key{display:flex;align-items:center;gap:7px;font-size:.875rem;color:#a4b9ad}.yrb-key i,.yrb-types-list i{display:inline-block;width:7px;height:7px;border-radius:2px}.yrb-chart-figs strong{font-size:25px;letter-spacing:-.04em}.yrb-plot{height:190px;position:relative;touch-action:pan-y}.yrb-plot svg{width:100%;height:100%;overflow:visible}
.yrb-types{grid-area:types;min-height:174px}.yrb-big-number{font-size:27px;font-weight:700;letter-spacing:-.04em}.yrb-big-number small{font-size:.875rem;color:#9bb3a6;font-weight:400}.yrb-segments{display:flex;gap:2px;height:10px;border-radius:10px;overflow:hidden;margin:10px 0 12px;background:#2c4036}.yrb-segments span{transition:width .7s}.yrb-types-list{display:grid;gap:8px}.yrb-types-list button{display:flex;justify-content:space-between;align-items:center;min-height:32px;gap:8px;background:none;border:0;padding:0;color:#b0c6ba;font-size:.875rem}.yrb-types-list button:hover{color:#fff}.yrb-types-list button span{display:flex;gap:6px;align-items:center;text-align:left}.yrb-types-list i{flex-shrink:0}.yrb-types-list button b{font-size:.875rem;color:#f4fff9}
.yrb-ai{grid-area:ai;min-height:365px;background:var(--yrb-accent);color:#0c3021;border:none;display:flex;flex-direction:column}.yrb-ai-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:7px}.yrb-ai-head h3{font-size:.875rem}.yrb-ai-head span{color:#174b34;font-size:.875rem}.yrb-ai-number{display:block;font-size:70px;font-weight:790;letter-spacing:-.08em;line-height:1;margin-top:25px}.yrb-ai-label{font-size:.875rem;color:#144d34;margin:0}.yrb-ai-rule{height:1px;background:#0b694555;margin:24px 0 17px}.yrb-ai h4{font-size:17px;line-height:1.2;margin:0 0 8px}.yrb-ai p{font-size:1rem;line-height:1.5;color:#145137;margin:0 0 12px}.yrb-ai .yrb-ai-caveat{font-size:.875rem;color:#225c42}.yrb-ai button{margin-top:auto;border:0;background:#0d2a20;color:#d1ffdf;padding:11px 10px;border-radius:10px;font-size:.875rem;font-weight:740}
.yrb-sla{grid-area:sla;min-height:174px}.yrb-sla-row{display:flex;gap:12px;align-items:baseline}.yrb-sla-row strong{font-size:33px;letter-spacing:-.06em}.yrb-sla-row span{font-size:.875rem;color:#aac1b2}.yrb-sla-pills{margin-top:9px}
.yrb-batches{grid-area:batches;min-height:184px}.yrb-batch-summary{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.yrb-batch-summary strong{font-size:25px}.yrb-batch-summary span{font-size:.875rem;color:#9fb9aa}.yrb-batch-bars{display:flex;align-items:end;gap:3px;height:62px;margin-top:10px;overflow:hidden}.yrb-batch-bars button{border:0;padding:0;background:#5a8970;border-radius:3px 3px 0 0;flex:1;min-width:0;transition:height .6s}.yrb-batch-bars button:last-child{background:#27E49A}
.yrb-activity{grid-area:activity;min-height:184px}.yrb-activity-list{display:grid;gap:5px}.yrb-activity-list button{display:flex;gap:9px;align-items:center;padding:5px;border:0;border-radius:8px;background:transparent;text-align:left;color:#f4fff9;width:100%}.yrb-activity-list button:hover{background:#243a2e}.yrb-activity-icon{display:grid;place-items:center;width:23px;height:23px;flex:0 0 23px;border-radius:6px;color:#27E49A;background:#284433}.yrb-activity-list button>span:nth-child(2){min-width:0;flex:1}.yrb-activity-list strong,.yrb-activity-list small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.yrb-activity-list strong{font-size:.875rem;font-weight:640}.yrb-activity-list small{font-size:.875rem;color:#91a89a;margin-top:2px}.yrb-activity-arrow{color:#8ec5a4;font-size:.875rem}
@container yrb (min-width:640px){.yrb-grid{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-areas:'hero hero' 'priority gauge' 'chart chart' 'types ai' 'sla ai' 'batches activity'}}
@container yrb (min-width:1024px){.yrb-grid{grid-template-columns:repeat(4,minmax(0,1fr));grid-template-areas:'hero hero priority gauge' 'chart chart types ai' 'chart chart sla ai' 'batches batches activity activity'}.yrb-hero{min-height:247px}.yrb-chart{min-height:377px}.yrb-ai{min-height:377px}.yrb-batches,.yrb-activity{min-height:190px}}
@media(max-width:540px){.yrb-banner{align-items:flex-start;flex-direction:column}.yrb-tile,.yrb-ai{border-radius:20px;padding:15px}.yrb-hero-number{font-size:32px}.yrb-hero-number small{display:block;margin-top:5px}.yrb-demo-tag{font-size:.875rem}}
.yrb{font-size:1rem;line-height:1.4}.yrb-empty{color:#A1B4AB;font-size:1rem;line-height:1.6;padding:12px 0}.yrb-chart-control{display:grid;gap:8px;font-size:.875rem;color:#A1B4AB;margin-top:18px}.yrb-chart-control input{width:100%;min-height:24px;accent-color:#27E49A;margin:0;cursor:pointer}.yrb input:focus-visible{outline:2px solid #27E49A;outline-offset:3px}.yrb-ai button:focus-visible{outline-color:#0B1110}.yrb-stack-card:focus-visible{outline-color:#F4FFF9}.yrb-stack-card strong{overflow-wrap:anywhere;max-width:100%}.yrb-activity-list strong{white-space:normal;line-height:1.4}.yrb-activity-list small{font-size:.8125rem;color:#A1B4AB;white-space:normal}.yrb-banner{flex-wrap:wrap}.yrb-chip{white-space:normal}.yrb-status{white-space:nowrap}.yrb-ai .yrb-ai-caveat{color:#123d2c;font-size:.875rem}.yrb-gauge-svg{margin-top:20px}
@container yrb (max-width:639px){.yrb-banner{align-items:flex-start;flex-direction:column}.yrb-hero-number small{display:block;margin-top:8px}.yrb-axis{gap:8px}.yrb-stack-card{width:min(90%,280px)}}
@media(prefers-reduced-motion:reduce){.yrb *,.yrb *::before,.yrb *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

