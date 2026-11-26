import * as React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type { DataBundle } from '../../domain/types';

function OverviewIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" focusable="false">
    <rect x="3.5" y="3.5" width="17" height="17" rx="3"/>
    <path d="M3.5 9h17M11 9v11.5M11 14.5h9.5"/>
  </svg>;
}

function EvaluationIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" focusable="false">
    <path d="M8 5H6.5A2.5 2.5 0 0 0 4 7.5v12A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5v-12A2.5 2.5 0 0 0 17.5 5H16"/>
    <path d="M10 4a2 2 0 0 1 4 0h1a1 1 0 0 1 1 1v2H8V5a1 1 0 0 1 1-1zM8 13l1.3 1.3 2.3-2.3M14 13h2.5M8 18l1.3 1.3 2.3-2.3M14 18h2.5"/>
  </svg>;
}

const NAV = [
  { to: '/dashboard', label: 'Visão geral', symbol: <OverviewIcon/>, description: 'Central operacional' },
  { to: '/reconciliation', label: 'Conciliação', symbol: '≡', description: 'Importação e regras' },
  { to: '/cases', label: 'Ocorrências', symbol: '⚑', description: 'Investigações' },
  { to: '/copilot', label: 'Copiloto IA', symbol: '✦', description: 'Explicação simulada' },
  { to: '/audit', label: 'Auditoria', symbol: '◷', description: 'Rastreabilidade' },
  { to: '/evaluation', label: 'Avaliação', symbol: <EvaluationIcon/>, description: 'Manual e assistido' },
];

/** Shell compartilhado. No celular, o menu captura foco e torna o conteúdo inerte. */
export function AppShell({ bundle, storageWarning }: { bundle: DataBundle; storageWarning: string }) {
  const [mobile, setMobile] = React.useState(false);
  const [compact, setCompact] = React.useState(() => window.matchMedia('(max-width: 700px)').matches);
  const menuRef = React.useRef<HTMLButtonElement>(null);
  const sidebarRef = React.useRef<HTMLElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const previousPath = React.useRef(pathname);
  const drawerOpen = compact && mobile;

  React.useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const update = () => { setCompact(media.matches); if (!media.matches) setMobile(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  React.useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    setMobile(false);
    const frame = requestAnimationFrame(() => {
      contentRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  React.useEffect(() => {
    if (!drawerOpen) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const items = () => Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    const frame = requestAnimationFrame(() => items()[0]?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobile(false); menuRef.current?.focus(); }
      if (event.key !== 'Tab') return;
      const focusable = items();
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(frame); document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKey); };
  }, [drawerOpen]);

  const closeMenu = () => { setMobile(false); menuRef.current?.focus(); };
  return <div className="app-shell">
    <a className="skip-link" href="#page-content">Ir para o conteúdo</a>
    <button ref={menuRef} className="mobile-menu" type="button" onClick={() => setMobile(value => !value)}
      aria-label={drawerOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={drawerOpen} aria-controls="main-navigation">☰</button>
    <aside ref={sidebarRef} id="main-navigation" className={`sidebar ${drawerOpen ? 'sidebar-open' : ''}`}
      inert={compact && !drawerOpen} role={drawerOpen ? 'dialog' : undefined} aria-modal={drawerOpen || undefined}
      aria-label="Menu principal">
      <button className="drawer-close" type="button" onClick={closeMenu}>Fechar menu</button>
      <div className="brand">
        <div className="brand-lockup">
          <img src={import.meta.env.BASE_URL + "brand/youresolve-sidebar.png"} alt=""/>
          <strong>You<span>Resolve</span> AI</strong>
        </div>
        <small>Intelligent Financial Operations</small>
      </div>
      <p className="sidebar-caption">ÁREA DE TRABALHO</p>
      <nav aria-label="Navegação principal">{NAV.map(item => <NavLink key={item.to} to={item.to}
        onClick={() => { setMobile(false); if (compact) requestAnimationFrame(() => contentRef.current?.focus()); }} className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}>
        <span className="nav-symbol" aria-hidden="true">{item.symbol}</span><span><strong>{item.label}</strong><small>{item.description}</small></span>
      </NavLink>)}</nav>
      <div className="sidebar-bottom"><strong>{bundle.source === 'demo' ? 'Ambiente de demonstração' : 'Dados locais importados'}</strong><p>Nenhum pagamento é executado por este protótipo.</p></div>
    </aside>
    {drawerOpen && <button className="mobile-scrim" type="button" tabIndex={-1} aria-label="Fechar menu" onClick={closeMenu}/>}
    <main className="main-content" inert={drawerOpen}>
      <header className="topbar"><div className="topbar-path">YOURESOLVE <span>/</span> OPERAÇÕES</div><div className="topbar-right"><span className="topbar-demo">{bundle.source === 'demo' ? 'Dados sintéticos' : 'CSV local'}</span><span className="avatar" aria-label="Perfil demonstrativo">YR</span></div></header>
      {storageWarning && <p className="storage-warning" role="status">{storageWarning}</p>}
      <div ref={contentRef} id="page-content" className="page-outlet" tabIndex={-1}><Outlet/></div>
    </main>
  </div>;
}
