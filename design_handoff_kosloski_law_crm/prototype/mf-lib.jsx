// Mid-fi shared UI kit for v2. Real-ish chrome, still neutral/placeholder.
// Keeps CSS namespaced (mf-*) so it doesn't collide with v1 sketch lib.

const MF = {
  ink: '#14181f',
  ink2: '#3a4251',
  ink3: '#6b7280',
  ink4: '#9aa1ad',
  line: '#e5e4de',
  line2: '#eeece6',
  bg: '#faf9f5',
  bg2: '#f3f1ea',
  card: '#ffffff',
  accent: 'var(--mf-accent, #3d83b8)',
  accentSoft: 'color-mix(in oklch, var(--mf-accent, #3d83b8) 15%, #fff)',
  hi: '#fff1bd',
  ok: '#2d8a5f',
  warn: '#b6623d',
  danger: '#c13c3c',
  fUI: 'Inter, ui-sans-serif, system-ui, sans-serif',
  fMono: '"JetBrains Mono", ui-monospace, monospace',
  fDisp: '"Fraunces", Georgia, serif',
};

if (typeof document !== 'undefined' && !document.getElementById('mf-styles')) {
  const s = document.createElement('style');
  s.id = 'mf-styles';
  s.textContent = `
  .mf{--mf-accent:#3d83b8;background:${MF.bg};color:${MF.ink};font-family:${MF.fUI};font-size:12.5px;line-height:1.4;width:100%;height:100%;overflow:hidden;position:relative;font-feature-settings:"ss01","cv11"}
  .mf *{box-sizing:border-box}
  .mf-row{display:flex;flex-direction:row}.mf-col{display:flex;flex-direction:column}
  .mf-flex1{flex:1;min-width:0;min-height:0}.mf-between{display:flex;align-items:center;justify-content:space-between}
  .mf-center{display:flex;align-items:center;justify-content:center}.mf-ai{align-items:center}.mf-as{align-items:flex-start}
  .mf-g4{gap:4px}.mf-g6{gap:6px}.mf-g8{gap:8px}.mf-g10{gap:10px}.mf-g12{gap:12px}.mf-g16{gap:16px}.mf-g20{gap:20px}
  .mf-p8{padding:8px}.mf-p10{padding:10px}.mf-p12{padding:12px}.mf-p14{padding:14px}.mf-p16{padding:16px}.mf-p20{padding:20px}
  .mf-px10{padding-left:10px;padding-right:10px}.mf-px14{padding-left:14px;padding-right:14px}
  .mf-py8{padding-top:8px;padding-bottom:8px}
  .mf-ink{color:${MF.ink}}.mf-ink2{color:${MF.ink2}}.mf-ink3{color:${MF.ink3}}.mf-ink4{color:${MF.ink4}}
  .mf-mono{font-family:${MF.fMono};font-feature-settings:"cv11"}
  .mf-disp{font-family:${MF.fDisp};font-weight:500;letter-spacing:-.01em}
  .mf-card{background:${MF.card};border:1px solid ${MF.line};border-radius:8px}
  .mf-card-flat{background:${MF.card};border:1px solid ${MF.line}}
  .mf-hairline{border-top:1px solid ${MF.line}}.mf-hl{border-bottom:1px solid ${MF.line}}
  .mf-rule{border:none;border-top:1px solid ${MF.line};margin:0}
  .mf-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid ${MF.line};border-radius:999px;font-size:11px;background:${MF.card};color:${MF.ink2};font-weight:500;white-space:nowrap}
  .mf-chip-fill{background:${MF.ink};border-color:${MF.ink};color:#fff}
  .mf-chip-accent{border-color:${MF.accent};color:${MF.accent};background:${MF.accentSoft}}
  .mf-chip-ok{border-color:#a4d4bc;color:${MF.ok};background:#ecf6f1}
  .mf-chip-warn{border-color:#e2c0ad;color:${MF.warn};background:#fbf0ea}
  .mf-chip-hi{background:${MF.hi};border-color:#e8d488;color:#5a4620}
  .mf-chip-ghost{background:transparent;border-style:dashed;color:${MF.ink3}}
  .mf-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:5px 10px;border:1px solid ${MF.line};border-radius:6px;background:${MF.card};font:500 12px ${MF.fUI};color:${MF.ink};cursor:default;white-space:nowrap;box-shadow:0 1px 0 rgba(0,0,0,.02)}
  .mf-btn:hover{border-color:${MF.ink3}}
  .mf-btn-primary{background:${MF.ink};border-color:${MF.ink};color:#fff;box-shadow:0 1px 0 rgba(0,0,0,.1)}
  .mf-btn-accent{background:${MF.accent};border-color:${MF.accent};color:#fff}
  .mf-btn-ghost{background:transparent;border-color:transparent;color:${MF.ink2}}
  .mf-btn-ghost:hover{background:${MF.bg2}}
  .mf-btn-sm{padding:3px 7px;font-size:11px;border-radius:5px}
  .mf-input{display:flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid ${MF.line};border-radius:6px;background:${MF.card};font:400 12px ${MF.fUI};color:${MF.ink3}}
  .mf-input:focus-within{border-color:${MF.ink3}}
  .mf-kbd{display:inline-block;padding:0 5px;height:16px;line-height:14px;border:1px solid ${MF.line};border-bottom-width:2px;border-radius:3px;font:500 10px ${MF.fMono};color:${MF.ink3};background:${MF.card}}
  .mf-nav{display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:6px;font-size:12.5px;color:${MF.ink2};cursor:default}
  .mf-nav:hover{background:${MF.bg2}}
  .mf-nav.on{background:${MF.ink};color:#fff}
  .mf-nav.on .mf-nav-badge{background:rgba(255,255,255,.2);color:#fff}
  .mf-nav-ic{width:16px;height:16px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;color:${MF.ink3}}
  .mf-nav.on .mf-nav-ic{color:#fff}
  .mf-nav-badge{margin-left:auto;font:500 10px ${MF.fMono};color:${MF.ink3};background:${MF.bg2};padding:1px 6px;border-radius:8px}
  .mf-sec{font:600 10px/1 ${MF.fUI};letter-spacing:.08em;text-transform:uppercase;color:${MF.ink4};padding:10px 10px 4px}
  .mf-dot{width:6px;height:6px;border-radius:3px;display:inline-block;flex-shrink:0}
  .mf-av{width:20px;height:20px;border-radius:10px;background:${MF.bg2};border:1px solid ${MF.line};display:inline-flex;align-items:center;justify-content:center;font:600 9px ${MF.fUI};color:${MF.ink2};flex-shrink:0}
  .mf-av-lg{width:28px;height:28px;border-radius:14px;font-size:11px}
  .mf-tabs{display:flex;gap:2px;border-bottom:1px solid ${MF.line};padding:0 10px}
  .mf-tab{padding:7px 10px;font:500 12px ${MF.fUI};color:${MF.ink3};border-bottom:2px solid transparent;margin-bottom:-1px;cursor:default;display:flex;align-items:center;gap:5px}
  .mf-tab.on{color:${MF.ink};border-bottom-color:${MF.ink}}
  .mf-seg{display:inline-flex;border:1px solid ${MF.line};border-radius:6px;background:${MF.card};padding:2px;gap:2px}
  .mf-seg>div{padding:3px 9px;font:500 11px ${MF.fUI};color:${MF.ink3};border-radius:4px;cursor:default;display:flex;align-items:center;gap:4px}
  .mf-seg>div.on{background:${MF.ink};color:#fff}
  .mf-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}
  .mf-table th{font:500 10px ${MF.fUI};letter-spacing:.04em;text-transform:uppercase;color:${MF.ink4};text-align:left;padding:6px 10px;background:${MF.bg2};border-bottom:1px solid ${MF.line};border-top:1px solid ${MF.line};white-space:nowrap}
  .mf-table td{padding:8px 10px;border-bottom:1px solid ${MF.line};vertical-align:middle}
  .mf-table tr:last-child td{border-bottom:none}
  .mf-table tr:hover td{background:${MF.bg2}}
  .mf-ph{background:repeating-linear-gradient(135deg,${MF.line2} 0 6px,${MF.bg} 6px 12px);color:${MF.ink3};font:500 10px ${MF.fMono};display:flex;align-items:center;justify-content:center;border-radius:6px}
  .mf-bar{height:6px;background:${MF.bg2};border-radius:3px;overflow:hidden;position:relative}
  .mf-bar>div{position:absolute;inset:0;right:auto;background:${MF.ink};border-radius:3px}
  .mf-divline{width:1px;background:${MF.line};align-self:stretch}
  .mf-hbar{height:1px;background:${MF.line}}
  .mf-banner{background:${MF.accentSoft};border:1px solid color-mix(in oklch, var(--mf-accent, #3d83b8) 40%, #fff);border-radius:8px;padding:10px 12px;color:${MF.ink}}
  .mf-pill{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;font:500 10.5px ${MF.fMono}}
  .mf-scroll::-webkit-scrollbar{width:8px;height:8px}.mf-scroll::-webkit-scrollbar-thumb{background:${MF.line};border-radius:4px}
  .mf-link{color:${MF.accent};text-decoration:none;cursor:default}
  .mf-link:hover{text-decoration:underline}
  `;
  document.head.appendChild(s);
}

// Tiny SVG icon set — stroke-based
const MFIcons = {
  home: 'M3 8l5-4 5 4v5H3z',
  inbox: 'M2 3h12v7l-3 3H5l-3-3z M2 9h3l1 2h4l1-2h3',
  file: 'M4 2h5l3 3v9H4z M9 2v3h3',
  folder: 'M2 4h4l1 1h7v8H2z',
  users: 'M5 9a2 2 0 100-4 2 2 0 000 4zm6 0a2 2 0 100-4 2 2 0 000 4zM2 14c0-2 1-3 3-3s3 1 3 3M9 14c0-1.5.7-2.5 2-2.8',
  cal: 'M3 4h10v9H3z M3 6h10 M6 2v3 M10 2v3',
  chart: 'M2 13h12 M4 10v3 M7 6v7 M10 8v5 M13 4v9',
  bolt: 'M9 1L3 9h4l-1 6 6-8H8z',
  search: 'M11 11l3 3 M7 12a5 5 0 100-10 5 5 0 000 10z',
  plus: 'M8 3v10 M3 8h10',
  dollar: 'M8 2v12 M11 5c-1-1-2-1.5-3-1.5S5 4 5 5.5 6 7 8 7s3 .5 3 2-1.5 2.5-3 2.5-2.5-.5-3-1.5',
  shield: 'M8 1l5 2v5c0 3-2 5-5 6-3-1-5-3-5-6V3z',
  check: 'M3 8l3 3 7-7',
  clock: 'M8 14a6 6 0 100-12 6 6 0 000 12z M8 4v4l3 2',
  filter: 'M2 3h12l-4 5v4l-4 2V8z',
  link: 'M7 9l2-2 M6 4l2-2a3 3 0 014 4l-2 2 M10 12l-2 2a3 3 0 01-4-4l2-2',
  gear: 'M8 10a2 2 0 100-4 2 2 0 000 4z M8 1v2 M8 13v2 M1 8h2 M13 8h2 M3 3l1.5 1.5 M11.5 11.5L13 13 M3 13l1.5-1.5 M11.5 4.5L13 3',
  layers: 'M8 2l6 3-6 3-6-3z M2 8l6 3 6-3 M2 11l6 3 6-3',
  ext: 'M6 4H3v9h9v-3 M8 3h5v5 M8 8l5-5',
  bell: 'M8 2a4 4 0 014 4v3l1 2H3l1-2V6a4 4 0 014-4z M6 13a2 2 0 004 0',
  tag: 'M2 2h6l6 6-6 6-6-6z M5 5h.01',
  mail: 'M2 4h12v8H2z M2 4l6 5 6-5',
  phone: 'M4 2l2 3-2 2c1 2 3 4 5 5l2-2 3 2-2 3c-6 0-11-5-11-11z',
  sms: 'M2 3h12v8H9l-3 3v-3H2z',
  video: 'M2 4h8v8H2z M10 7l4-2v6l-4-2',
  gavel: 'M3 13h10 M5 11l6-6 M4 8l3-3 3 3 M8 5l3-3 3 3-3 3z',
  pipe: 'M2 5h5v2H2z M9 5h5v2H9z M7 6h2 M6 3v6 M10 3v6',
  trophy: 'M5 2h6v3a3 3 0 01-6 0z M3 3h2v2a2 2 0 01-2-2zm10 0h-2v2a2 2 0 002-2zM6 8h4v4H6z M4 14h8',
  send: 'M2 8l12-6-6 12-2-4z M8 8l-4-2',
  doc: 'M4 2h5l3 3v9H4z M9 2v3h3 M6 8h4 M6 10h4 M6 12h3',
  archive: 'M2 3h12v3H2z M3 6v8h10V6 M6 9h4',
  reply: 'M7 3L2 8l5 5 M2 8h7a4 4 0 014 4v1',
  user: 'M8 8a3 3 0 100-6 3 3 0 000 6z M2 14c.5-3 3-5 6-5s5.5 2 6 5',
  warn: 'M8 2l6 11H2z M8 6v4 M8 12v.01',
  star: 'M8 2l2 4 4.5.5-3.3 3 .8 4.5L8 12l-4 2 .8-4.5-3.3-3L6 6z',
  more: 'M4 8h.01 M8 8h.01 M12 8h.01',
  trash: 'M3 4h10 M5 4V2h6v2 M4 4l1 10h6l1-10 M6 7v4 M10 7v4',
  flag: 'M3 2v12 M3 3h9l-2 3 2 3H3',
  close: 'M4 4l8 8 M12 4l-8 8',
  minus: 'M3 8h10',
  expand: 'M3 3h4 M3 3v4 M13 13h-4 M13 13v-4 M3 3l4 4 M13 13l-4-4',
  sparkle: 'M8 2v4 M8 10v4 M2 8h4 M10 8h4 M4 4l2 2 M12 12l-2-2 M12 4l-2 2 M4 12l2-2',
  copy: 'M5 2h7v10H5z M3 5v9h8',
  print: 'M4 2h8v4H4z M3 6h10v5H3z M5 9h6 M5 11v3h6v-3',
  pin: 'M8 2l3 3-1 1 2 2-2 2-2-2-1 1-3-3 1-1-2-2 2-2 1 1z M6 10l-4 4',
  refresh: 'M13 3v3h-3 M3 8a5 5 0 019-3 M3 13v-3h3 M13 8a5 5 0 01-9 3',
};

function Icon({ n, size = 14, stroke = 1.5, style, fill = 'none' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill={fill} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d={MFIcons[n] || ''} />
    </svg>
  );
}

// Primitives
function Btn({ children, primary, accent, ghost, sm, icon, ...p }) {
  const cls = ['mf-btn', primary && 'mf-btn-primary', accent && 'mf-btn-accent', ghost && 'mf-btn-ghost', sm && 'mf-btn-sm'].filter(Boolean).join(' ');
  return <button className={cls} {...p}>{icon && <Icon n={icon} size={sm ? 11 : 13} />}{children}</button>;
}
function Chip({ children, fill, accent, ok, warn, hi, ghost, style, dot }) {
  const cls = ['mf-chip', fill && 'mf-chip-fill', accent && 'mf-chip-accent', ok && 'mf-chip-ok', warn && 'mf-chip-warn', hi && 'mf-chip-hi', ghost && 'mf-chip-ghost'].filter(Boolean).join(' ');
  return <span className={cls} style={style}>{dot && <span className="mf-dot" style={{background: dot}} />}{children}</span>;
}
function Seg({ options, value, onChange, icons }) {
  return (
    <div className="mf-seg">
      {options.map((o, i) => (
        <div key={o} className={value === o ? 'on' : ''} onClick={() => onChange && onChange(o)}>
          {icons && icons[i] && <Icon n={icons[i]} size={11} />}
          {o}
        </div>
      ))}
    </div>
  );
}
function Av({ initials, lg, color, style }) {
  return <span className={`mf-av ${lg ? 'mf-av-lg' : ''}`} style={{ background: color || MF.bg2, ...style }}>{initials}</span>;
}
function Nav({ icon, label, on, badge, right, dot }) {
  return (
    <div className={`mf-nav ${on ? 'on' : ''}`}>
      {dot && <span className="mf-dot" style={{ background: dot }} />}
      {icon && <span className="mf-nav-ic"><Icon n={icon} size={14} /></span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {badge !== undefined && <span className="mf-nav-badge">{badge}</span>}
      {right}
    </div>
  );
}
function SectionLabel({ children, right }) {
  return (
    <div className="mf-between" style={{ padding: '10px 10px 4px' }}>
      <div className="mf-sec" style={{ padding: 0 }}>{children}</div>
      {right}
    </div>
  );
}
function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mf-tabs">
      {tabs.map((t) => (
        <div key={t.id || t} className={`mf-tab ${value === (t.id || t) ? 'on' : ''}`} onClick={() => onChange && onChange(t.id || t)}>
          {t.icon && <Icon n={t.icon} size={12} />}
          {t.label || t}
          {t.badge !== undefined && <span className="mf-mono mf-ink4" style={{ fontSize: 10 }}>{t.badge}</span>}
        </div>
      ))}
    </div>
  );
}

// Shell components — title bar, sidebar, etc
function Shell({ sidebar, children, topbar, statusbar }) {
  return (
    <div className="mf mf-row">
      {sidebar}
      <div className="mf-col mf-flex1">
        {topbar}
        <div className="mf-col mf-flex1" style={{ background: MF.bg, overflow: 'hidden' }}>{children}</div>
        {statusbar}
      </div>
    </div>
  );
}

function TopBar({ title, crumbs, right, below, sub }) {
  return (
    <div className="mf-col" style={{ borderBottom: `1px solid ${MF.line}`, background: MF.card, flexShrink: 0 }}>
      <div className="mf-between" style={{ padding: '10px 16px' }}>
        <div className="mf-col" style={{ gap: 2 }}>
          {crumbs && <div className="mf-mono mf-ink4" style={{ fontSize: 10, letterSpacing: '.04em' }}>{crumbs}</div>}
          <div className="mf-row mf-ai mf-g8">
            <div className="mf-disp" style={{ fontSize: 20 }}>{title}</div>
            {sub}
          </div>
        </div>
        <div className="mf-row mf-g8 mf-ai">{right}</div>
      </div>
      {below}
    </div>
  );
}

function Sidebar({ children, wide = 208, title, user }) {
  return (
    <div className="mf-col" style={{ width: wide, background: MF.bg2, borderRight: `1px solid ${MF.line}`, flexShrink: 0, height: '100%' }}>
      <div className="mf-between mf-p12" style={{ paddingBottom: 8 }}>
        <div className="mf-row mf-g8 mf-ai">
          <div style={{ width: 22, height: 22, background: MF.ink, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: MF.fDisp, fontSize: 14, fontWeight: 600 }}>k</div>
          <div className="mf-disp" style={{ fontSize: 14 }}>{title || 'Kosloski'}</div>
        </div>
        <span className="mf-kbd">⌘K</span>
      </div>
      <div className="mf-col mf-flex1 mf-scroll" style={{ padding: '0 6px 10px', overflowY: 'auto', gap: 1 }}>{children}</div>
      {user && <div className="mf-hl" />}
      {user && (
        <div className="mf-row mf-g8 mf-ai mf-p10">
          <Av initials={user.initials} color={user.color} />
          <div className="mf-col" style={{ gap: 0, minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
            <div className="mf-ink4" style={{ fontSize: 10.5 }}>{user.role}</div>
          </div>
          <Icon n="gear" size={14} style={{ color: MF.ink4 }} />
        </div>
      )}
    </div>
  );
}

// placeholder that looks like image content
function Ph({ h = 80, w, label, style }) {
  return <div className="mf-ph" style={{ height: h, width: w || '100%', ...style }}>{label}</div>;
}

Object.assign(window, { MF, Icon, Btn, Chip, Seg, Av, Nav, SectionLabel, Tabs, Shell, TopBar, Sidebar, Ph });
