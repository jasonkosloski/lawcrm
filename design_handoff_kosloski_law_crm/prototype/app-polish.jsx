// Final-prototype polish layer.
// Adds:
//  - refined typography + motion tokens on top of mf-*
//  - a real router (hash-based) + active state
//  - a ⌘K command palette that actually opens/closes
//  - a keyboard shortcut system (g d for dashboard, g m for matters, ...)
//  - subtle screen transitions
//  - a polished "attorney partner" sidebar w/ working nav
//  - upgraded matter switcher w/ recents

(() => {
  if (document.getElementById('app-polish-styles')) return;
  const s = document.createElement('style');
  s.id = 'app-polish-styles';
  s.textContent = `
    /* typography refinements */
    .mf { font-feature-settings: "ss01","cv11","cv02"; }
    .mf-disp { letter-spacing: -0.018em; font-weight: 500; }
    .app-h1 { font-family: "Fraunces", Georgia, serif; font-weight: 500; letter-spacing: -0.02em; }

    /* subtle motion */
    .app-fade-enter { animation: appFade .22s ease-out both; }
    @keyframes appFade {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* nav active + hover polish */
    .mf-nav { transition: background .12s ease, color .12s ease; cursor: pointer; }
    .mf-nav:hover { background: #eeece6; }
    .mf-nav.on { background: #14181f; color: #fff; }

    /* button interaction */
    .mf-btn { cursor: pointer; transition: border-color .12s ease, background .12s ease, transform .06s ease; }
    .mf-btn:active { transform: translateY(0.5px); }
    .mf-btn-primary:hover { background: #2a2f38; border-color: #2a2f38; }
    .mf-btn-accent:hover { filter: brightness(1.05); }

    /* chips clickable */
    .mf-chip { cursor: default; }

    /* card hover */
    .app-card-hover { transition: box-shadow .16s ease, border-color .16s ease; }
    .app-card-hover:hover { border-color: #d5d3cd; box-shadow: 0 2px 0 rgba(0,0,0,.02), 0 8px 22px -12px rgba(20,24,31,.12); }

    /* table row click affordance */
    .mf-table tbody tr { cursor: pointer; }

    /* focus ring */
    .mf *:focus-visible { outline: 2px solid var(--mf-accent, #3d83b8); outline-offset: 1px; border-radius: 4px; }

    /* palette overlay */
    .app-palette-overlay {
      position: fixed; inset: 0; z-index: 1000;
      background: rgba(20,24,31,.28);
      backdrop-filter: blur(2px);
      animation: appFade .16s ease-out both;
    }
    .app-palette {
      position: absolute; top: 12%; left: 50%; transform: translateX(-50%);
      width: 640px; max-width: calc(100vw - 40px);
      background: #fff; border: 1px solid #e5e4de; border-radius: 12px;
      box-shadow: 0 30px 80px -20px rgba(20,24,31,.5);
      overflow: hidden; font-family: Inter, system-ui, sans-serif;
      animation: palettePop .2s cubic-bezier(.2,.8,.2,1) both;
    }
    @keyframes palettePop {
      from { opacity: 0; transform: translate(-50%, -8px) scale(.98); }
      to   { opacity: 1; transform: translate(-50%, 0) scale(1); }
    }
    .app-palette-row { padding: 8px 16px; display: flex; align-items: center; gap: 12px; cursor: pointer; }
    .app-palette-row:hover, .app-palette-row.on { background: #f3f1ea; }
    .app-palette-row.on { background: color-mix(in oklch, var(--mf-accent, #3d83b8) 14%, #fff); }

    /* status bar under sidebar bottom */
    .app-statusbar { height: 26px; background: #f3f1ea; border-top: 1px solid #e5e4de;
      display:flex; align-items:center; gap: 14px; padding: 0 14px; font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 10.5px; color: #6b7280; }
    .app-statusbar .dot { width: 6px; height: 6px; border-radius: 3px; background: #2d8a5f; }

    /* command helper popover (shortcut cheatsheet) */
    .app-shortcuts {
      position: fixed; right: 18px; bottom: 42px; z-index: 60;
      width: 240px; background: #fff; border: 1px solid #e5e4de; border-radius: 10px;
      box-shadow: 0 10px 30px -10px rgba(20,24,31,.15);
      padding: 10px 12px; font-family: Inter, sans-serif; font-size: 12px;
      animation: appFade .22s ease-out both;
    }

    /* toast */
    .app-toast {
      position: fixed; left: 50%; bottom: 48px; transform: translateX(-50%);
      background: #14181f; color: #fff; padding: 8px 14px; border-radius: 8px; z-index: 200;
      font-size: 12.5px; font-family: Inter, sans-serif;
      box-shadow: 0 12px 30px -10px rgba(0,0,0,.4);
      animation: toastPop .22s cubic-bezier(.2,.8,.2,1) both;
    }
    @keyframes toastPop {
      from { opacity: 0; transform: translate(-50%, 8px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }

    /* global inline mini-chart */
    .app-spark { display: inline-block; vertical-align: middle; }

    /* ribbon notifications dot */
    .app-bell-dot { position: relative; }
    .app-bell-dot::after { content: ''; position: absolute; top: -2px; right: -2px; width: 7px; height: 7px; border-radius: 4px; background: #c13c3c; border: 1.5px solid #fff; }

    /* subtle divider between main areas */
    .app-main-bg { background: #faf9f5; }

    /* matter avatar strip */
    .app-av-strip { display:inline-flex; }
    .app-av-strip > * { margin-left: -6px; border: 1.5px solid #fff; box-sizing: content-box; }
    .app-av-strip > *:first-child { margin-left: 0; }

    /* progress ring */
    .app-ring { transform: rotate(-90deg); }
  `;
  document.head.appendChild(s);
})();

// ── router ──
const Router = React.createContext({ path: 'today', go: () => {} });

function useHashRoute(initial = 'today') {
  const [path, setPath] = React.useState(() => (location.hash || '').replace(/^#\/?/, '') || initial);
  React.useEffect(() => {
    const h = () => setPath((location.hash || '').replace(/^#\/?/, '') || initial);
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, [initial]);
  const go = React.useCallback((p) => { location.hash = '#/' + p; }, []);
  return [path, go];
}

// ── attorney sidebar (polished, clickable) ──
function AppSidebar({ path, go }) {
  const NavItem = ({ id, icon, label, badge, dot, section }) => (
    <div className={`mf-nav ${path === id || path.startsWith(id + '/') ? 'on' : ''}`}
         onClick={() => go(id)}>
      {dot && <span className="mf-dot" style={{ background: dot }} />}
      {icon && <span className="mf-nav-ic"><Icon n={icon} size={14} /></span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {badge !== undefined && <span className="mf-nav-badge">{badge}</span>}
    </div>
  );
  return (
    <div className="mf-col" style={{ width: 220, background: MF.bg2, borderRight: `1px solid ${MF.line}`, flexShrink: 0, height: '100%' }}>
      <div className="mf-between mf-p12" style={{ paddingBottom: 8 }}>
        <div className="mf-row mf-g8 mf-ai">
          <div style={{ width: 24, height: 24, background: MF.ink, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: MF.fDisp, fontSize: 15, fontWeight: 600, letterSpacing: '-.04em' }}>k</div>
          <div className="mf-disp" style={{ fontSize: 14 }}>Kosloski Law</div>
        </div>
        <button className="mf-kbd" style={{ cursor: 'pointer' }} onClick={() => window.dispatchEvent(new CustomEvent('app-open-palette'))}>⌘K</button>
      </div>
      <div className="mf-col mf-flex1 mf-scroll" style={{ padding: '0 6px 10px', overflowY: 'auto', gap: 1 }}>
        <NavItem id="today"    icon="home"  label="Today" />
        <NavItem id="matters"  icon="gavel" label="Matters"    badge="34" />
        <NavItem id="intake"   icon="inbox" label="Intake"     badge="23" />
        <NavItem id="email"    icon="mail"  label="Email"      badge="23" />
        <NavItem id="calendar" icon="cal"   label="Calendar"   badge="9" />
        <NavItem id="time"     icon="clock" label="Time"       badge="47.2h" />
        <NavItem id="billing"  icon="dollar" label="Billing"   badge="12" />
        <SectionLabel right={<Icon n="plus" size={12} style={{ color: MF.ink4, cursor: 'pointer' }} />}>Practice areas</SectionLabel>
        <NavItem id="area/1983"       label="§1983 / civil rights"  badge="18" dot="#3d83b8" />
        <NavItem id="area/cada"       label="Employment · CADA"      badge="6"  dot="#b6623d" />
        <NavItem id="area/fha"        label="Housing · FHA"          badge="4"  dot="#2d8a5f" />
        <NavItem id="area/criminal"   label="Criminal (flat)"        badge="3"  dot="#7a5aa6" />
        <NavItem id="area/class"      label="Class actions"          badge="2"  dot="#8a6a2d" />
        <SectionLabel>Pinned matters</SectionLabel>
        <NavItem id="matter/alvarez"  label="Alvarez v. Aurora PD" dot="#3d83b8" />
        <NavItem id="matter/williams" label="Williams v. Denver"   dot="#3d83b8" />
        <NavItem id="matter/aurora"   label="In re: Aurora class"  dot="#8a6a2d" />
        <NavItem id="matter/rivera"   label="Rivera v. Lakewood"   dot="#3d83b8" />
        <div style={{ flex: 1 }} />
        <SectionLabel>Firm</SectionLabel>
        <NavItem id="reports"      icon="chart"  label="Reports" />
        <NavItem id="automations"  icon="bolt"   label="Automations" badge="14" />
        <NavItem id="settings"     icon="gear"   label="Settings" />
      </div>
      <div className="mf-hl" />
      <div className="mf-row mf-g8 mf-ai mf-p10">
        <Av initials="JM" color="#efe3d9" lg />
        <div className="mf-col" style={{ gap: 0, minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11.5, fontWeight: 500 }}>Jane Marsh</div>
          <div className="mf-ink4" style={{ fontSize: 10.5 }}>Attorney · partner</div>
        </div>
        <span className="app-bell-dot"><Icon n="bell" size={14} style={{ color: MF.ink3 }} /></span>
      </div>
      <div className="app-statusbar">
        <span className="dot" /> synced · 2s ago
        <span style={{ marginLeft: 'auto' }}>v1.0</span>
      </div>
    </div>
  );
}

// ── command palette ──
function CommandPalette({ open, onClose, go }) {
  const [q, setQ] = React.useState('');
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (open) { setQ(''); setIdx(0); setTimeout(() => inputRef.current?.focus(), 20); }
  }, [open]);

  const all = React.useMemo(() => [
    { kind: 'Go to',  ic: 'home',   label: 'Today',             to: 'today',            k: 'g d' },
    { kind: 'Go to',  ic: 'gavel',  label: 'Matters',           to: 'matters',          k: 'g m' },
    { kind: 'Go to',  ic: 'inbox',  label: 'Intake queue',      to: 'intake',           k: 'g i' },
    { kind: 'Go to',  ic: 'cal',    label: 'Calendar',          to: 'calendar',         k: 'g c' },
    { kind: 'Go to',  ic: 'dollar', label: 'Billing · today',   to: 'billing',          k: 'g b' },
    { kind: 'Matter', ic: 'gavel',  label: 'Alvarez v. City of Aurora',  sub: '§1983 · Discovery',   to: 'matter/alvarez' },
    { kind: 'Matter', ic: 'gavel',  label: 'Williams v. Denver',         sub: '§1983 · Dispositive', to: 'matter/williams' },
    { kind: 'Matter', ic: 'gavel',  label: 'In re: Aurora class',        sub: 'Class · Cert',        to: 'matter/aurora' },
    { kind: 'Matter', ic: 'gavel',  label: 'Rivera v. Lakewood',         sub: 'Settled · distribute', to: 'matter/rivera' },
    { kind: 'Matter', ic: 'gavel',  label: 'Patel · FHA',                sub: 'Housing · Retained',  to: 'matters' },
    { kind: 'Matter', ic: 'gavel',  label: 'Moreno · CADA',              sub: 'Employment · Pre-suit', to: 'matters' },
    { kind: 'Action', ic: 'plus',   label: 'New matter',              k: 'n m' },
    { kind: 'Action', ic: 'plus',   label: 'New lead',                k: 'n l' },
    { kind: 'Action', ic: 'clock',  label: 'Start timer on Alvarez',  k: 't a' },
    { kind: 'Action', ic: 'file',   label: 'Generate CGIA notice — Alvarez' },
    { kind: 'Action', ic: 'bolt',   label: 'Run §1983 onboarding automation' },
    { kind: 'Action', ic: 'shield', label: 'Run conflict check' },
    { kind: 'People', ic: 'users',  label: 'Alvarez, Maria', sub: 'client · 1 matter' },
    { kind: 'People', ic: 'users',  label: 'Alvarado, Ruben', sub: 'opposing counsel · 2 matters' },
    { kind: 'People', ic: 'users',  label: 'Officer Doe #4412 (APD)', sub: 'party · 1 matter · UOF hist.' },
  ], []);

  const results = React.useMemo(() => {
    if (!q.trim()) return all;
    const t = q.trim().toLowerCase();
    return all.filter(r => r.label.toLowerCase().includes(t) || (r.sub||'').toLowerCase().includes(t) || r.kind.toLowerCase().includes(t));
  }, [q, all]);

  React.useEffect(() => { setIdx(0); }, [q]);

  const onKey = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[idx];
      if (r?.to) { go(r.to); onClose(); }
      else if (r) { window.dispatchEvent(new CustomEvent('app-toast', { detail: `✦ ${r.label}` })); onClose(); }
    }
  };

  if (!open) return null;

  // group by kind preserving order
  const grouped = [];
  const seen = new Set();
  results.forEach((r) => {
    if (!seen.has(r.kind)) { grouped.push({ header: r.kind, items: [] }); seen.add(r.kind); }
    grouped[grouped.length - 1].items.push(r);
  });

  let running = 0;
  return (
    <div className="app-palette-overlay" onClick={onClose}>
      <div className="app-palette" onClick={(e) => e.stopPropagation()}>
        <div className="mf-row mf-g10 mf-ai" style={{ padding: '14px 16px', borderBottom: `1px solid ${MF.line}` }}>
          <Icon n="search" size={16} style={{ color: MF.ink3 }} />
          <input ref={inputRef}
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontFamily: MF.fUI, background: 'transparent' }}
            placeholder="Search matters, people, docs, or run a command…"
            value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
          <span className="mf-kbd">esc</span>
        </div>
        <div className="mf-col" style={{ maxHeight: 420, overflowY: 'auto' }}>
          {grouped.map((g, gi) => (
            <React.Fragment key={g.header}>
              <div className="mf-sec" style={{ padding: '8px 16px 2px' }}>{g.header}</div>
              {g.items.map((r) => {
                const my = running++;
                return (
                  <div key={my} className={`app-palette-row ${my === idx ? 'on' : ''}`}
                    onMouseEnter={() => setIdx(my)}
                    onClick={() => { if (r.to) { go(r.to); onClose(); } else { window.dispatchEvent(new CustomEvent('app-toast', { detail: `✦ ${r.label}` })); onClose(); } }}>
                    <Icon n={r.ic} size={14} style={{ color: MF.ink3 }} />
                    <div className="mf-col mf-flex1" style={{ gap: 0 }}>
                      <div style={{ fontSize: 13 }}>{r.label}</div>
                      {r.sub && <div className="mf-ink3" style={{ fontSize: 11 }}>{r.sub}</div>}
                    </div>
                    {r.k ? <span className="mf-kbd">{r.k}</span> : r.to ? <span className="mf-kbd">↵</span> : null}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
          {results.length === 0 && (
            <div className="mf-ink3" style={{ padding: '24px 16px', fontSize: 12, textAlign: 'center' }}>
              No results for "{q}"
            </div>
          )}
        </div>
        <div className="mf-between mf-p8" style={{ background: MF.bg2, borderTop: `1px solid ${MF.line}` }}>
          <div className="mf-row mf-g10 mf-ai" style={{ fontSize: 10.5, color: MF.ink3 }}>
            <span><span className="mf-kbd">↑↓</span> navigate</span>
            <span><span className="mf-kbd">↵</span> select</span>
            <span><span className="mf-kbd">tab</span> filter</span>
          </div>
          <span className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>⌘K anywhere · 1,284 indexed</span>
        </div>
      </div>
    </div>
  );
}

// Toast
function Toaster() {
  const [msg, setMsg] = React.useState(null);
  React.useEffect(() => {
    const h = (e) => {
      setMsg(e.detail);
      clearTimeout(h._t);
      h._t = setTimeout(() => setMsg(null), 1900);
    };
    window.addEventListener('app-toast', h);
    return () => window.removeEventListener('app-toast', h);
  }, []);
  if (!msg) return null;
  return <div className="app-toast">{msg}</div>;
}

Object.assign(window, { useHashRoute, AppSidebar, CommandPalette, Toaster });
