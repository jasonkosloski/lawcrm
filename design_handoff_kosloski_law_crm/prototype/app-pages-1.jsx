// Final prototype — top-level pages (attorney partner POV).
// Each page is a polished take that stands on its own; they all share chrome
// via AppShell + AppSidebar + AppTopBar.

// ── AppShell ────────────────────────────────────────────────────────────────
function AppShell({ path, go, children, topbar }) {
  return (
    <div className="mf mf-row" style={{ '--mf-accent': 'var(--app-accent, #3d83b8)' }}>
      <AppSidebar path={path} go={go} />
      <div className="mf-col mf-flex1" style={{ minWidth: 0 }}>
        {topbar}
        <div className="mf-col mf-flex1 app-main-bg app-fade-enter" key={path} style={{ overflow: 'hidden', minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ── TOP BAR ────────────────────────────────────────────────────────────────
function AppTopBar({ crumbs, title, sub, right, below }) {
  return (
    <div className="mf-col" style={{ borderBottom: `1px solid ${MF.line}`, background: MF.card, flexShrink: 0 }}>
      <div className="mf-between" style={{ padding: '11px 18px' }}>
        <div className="mf-col" style={{ gap: 2, minWidth: 0 }}>
          {crumbs && <div className="mf-mono mf-ink4" style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase' }}>{crumbs}</div>}
          <div className="mf-row mf-ai mf-g10" style={{ minWidth: 0 }}>
            <div className="app-h1" style={{ fontSize: 22, lineHeight: 1.1 }}>{title}</div>
            {sub}
          </div>
        </div>
        <div className="mf-row mf-g8 mf-ai" style={{ flexShrink: 0 }}>{right}</div>
      </div>
      {below}
    </div>
  );
}

// Global search chip — shared across top bars
function GlobalSearch() {
  return (
    <div className="mf-input" style={{ width: 260, cursor: 'pointer' }}
         onClick={() => window.dispatchEvent(new CustomEvent('app-open-palette'))}>
      <Icon n="search" size={12} />
      <span>Search or run a command</span>
      <span className="mf-kbd" style={{ marginLeft: 'auto' }}>⌘K</span>
    </div>
  );
}

// ── TODAY (home) ────────────────────────────────────────────────────────────
function PageToday({ go }) {
  return (
    <AppShell path="today" go={go} topbar={
      <AppTopBar
        crumbs="ATTORNEY · PARTNER"
        title="Good morning, Jane"
        sub={<span className="mf-ink3" style={{ fontSize: 13, marginLeft: 4 }}>Thursday, April 23 · 2026</span>}
        right={<>
          <GlobalSearch />
          <Btn icon="clock">Start timer</Btn>
          <Btn primary icon="plus">New matter</Btn>
        </>}
      />
    }>
      <div className="mf-scroll" style={{ overflowY: 'auto', flex: 1 }}>
        <div className="mf-p16 mf-col mf-g14" style={{ maxWidth: 1180, margin: '0 auto', width: '100%', padding: 20 }}>

          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { l: 'Open matters', v: '34', s: '+2 this week', to: 'matters' },
              { l: 'Deadlines · 14d', v: '9', s: '2 critical · Alvarez CGIA', to: 'calendar' },
              { l: 'Unbilled hours', v: '47.2', s: '$18,880 WIP', to: 'time' },
              { l: 'Trust held', v: '$432k', s: 'Rivera ready to distribute →', to: 'settlement/rivera' },
            ].map(c => (
              <div key={c.l} className="mf-card mf-p14 app-card-hover" onClick={() => go(c.to)}>
                <div className="mf-ink4" style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>{c.l}</div>
                <div className="app-h1" style={{ fontSize: 28, marginTop: 6 }}>{c.v}</div>
                <div className="mf-ink3" style={{ fontSize: 11.5, marginTop: 2 }}>{c.s}</div>
              </div>
            ))}
          </div>

          {/* row 1: agenda + deadlines */}
          <div className="mf-row mf-g12" style={{ alignItems: 'stretch' }}>
            <div className="mf-card mf-flex1">
              <div className="mf-between mf-p12 mf-hl">
                <div style={{ fontWeight: 600 }}>Today's agenda</div>
                <Seg options={['Agenda', 'Day', 'Week']} value="Agenda" />
              </div>
              <div className="mf-col">
                {[
                  { t: '09:00', title: 'Intake call · Alvarez',            kind: 'Zoom · ES',  now: true,  area: '§1983', to: 'matter/alvarez' },
                  { t: '10:30', title: 'Meet & confer · Williams',         kind: 'Tel',        now: false, area: '§1983', to: 'matter/williams' },
                  { t: '13:00', title: 'Deposition prep · Officer Doe',    kind: 'Office',     now: false, area: '§1983', to: 'matter/alvarez' },
                  { t: '15:30', title: 'Class cert brief — block time',    kind: 'Focus',      now: false, area: 'class', to: 'matter/aurora' },
                  { t: '16:30', title: 'Partner review · Moreno',          kind: 'Office',     now: false, area: 'CADA',  to: 'matters' },
                ].map((r, i, arr) => (
                  <div key={i} className="mf-row mf-g12 mf-p10" style={{ borderBottom: i < arr.length - 1 ? `1px solid ${MF.line}` : 'none', background: r.now ? MF.accentSoft : 'transparent', cursor: 'pointer' }}
                       onClick={() => go(r.to)}>
                    <div className="mf-mono" style={{ width: 48, color: r.now ? MF.accent : MF.ink3, fontSize: 11.5, fontWeight: 600 }}>{r.t}</div>
                    <div className="mf-col mf-flex1" style={{ gap: 2 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{r.title}</div>
                      <div className="mf-row mf-g6 mf-ai">
                        <span className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>{r.kind}</span>
                        <Chip style={{ fontSize: 10 }}>{r.area}</Chip>
                      </div>
                    </div>
                    {r.now && <Btn sm accent>Join</Btn>}
                  </div>
                ))}
              </div>
            </div>

            <div className="mf-card" style={{ width: 340 }}>
              <div className="mf-between mf-p12 mf-hl">
                <div style={{ fontWeight: 600 }}>Next deadlines</div>
                <span className="mf-link" style={{ fontSize: 11, cursor: 'pointer' }} onClick={() => go('calendar')}>calendar →</span>
              </div>
              <div className="mf-col">
                {[
                  { d: 'Apr 30', t: 'Rivera — distribution',   k: 'critical', until: '7d',  to: 'settlement/rivera' },
                  { d: 'May 12', t: 'Alvarez — CGIA notice',   k: 'auto',     until: '19d', to: 'matter/alvarez' },
                  { d: 'May 15', t: 'Williams — Rule 26',      k: 'auto',     until: '22d', to: 'matter/williams' },
                  { d: 'May 20', t: 'Alvarez — CORA response', k: 'manual',   until: '27d', to: 'matter/alvarez' },
                  { d: 'May 28', t: 'Patel — HUD response',    k: 'auto',     until: '35d', to: 'matters' },
                ].map((r, i, arr) => (
                  <div key={i} className="mf-row mf-g10 mf-p10 mf-ai" style={{ borderBottom: i < arr.length - 1 ? `1px solid ${MF.line}` : 'none', cursor: 'pointer' }}
                       onClick={() => go(r.to)}>
                    <div className="mf-col" style={{ width: 52, gap: 0 }}>
                      <div className="mf-mono" style={{ fontSize: 11, fontWeight: 600, color: MF.ink3 }}>{r.d.split(' ')[0]}</div>
                      <div className="mf-mono app-h1" style={{ fontSize: 20, lineHeight: 1 }}>{r.d.split(' ')[1]}</div>
                    </div>
                    <div className="mf-col mf-flex1" style={{ gap: 2 }}>
                      <div style={{ fontSize: 12 }}>{r.t}</div>
                      <div className="mf-row mf-g4 mf-ai">
                        {r.k === 'critical' ? <Chip warn>critical</Chip> : r.k === 'auto' ? <Chip>auto-rule</Chip> : <Chip ghost>manual</Chip>}
                        <span className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>in {r.until}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* row 2: pipeline + activity */}
          <div className="mf-row mf-g12" style={{ alignItems: 'stretch' }}>
            <div className="mf-card mf-flex1 mf-p12">
              <div className="mf-between">
                <div style={{ fontWeight: 600 }}>My matters by stage</div>
                <Seg options={['Pipeline', 'List', 'Cards']} value="Pipeline" icons={['layers', 'inbox', 'folder']} />
              </div>
              <div className="mf-row mf-g6" style={{ marginTop: 12, overflowX: 'auto' }}>
                {[
                  { l: 'Intake',       n: 3,  c: '#e5e4de', note: '' },
                  { l: 'Retained',     n: 6,  c: '#d9e7f1', note: '' },
                  { l: 'Discovery',    n: 12, c: '#3d83b8', note: '3 near deadline' },
                  { l: 'Dispositive',  n: 7,  c: '#2b5f80', note: '' },
                  { l: 'Trial/settle', n: 4,  c: '#14181f', note: 'Rivera ready' },
                  { l: 'Closed',       n: 24, c: MF.line,   note: '' },
                ].map((s, i) => (
                  <div key={s.l} className="mf-col mf-flex1" style={{ minWidth: 130, gap: 4 }}>
                    <div className="mf-between"><span className="mf-ink3" style={{ fontSize: 11 }}>{s.l}</span><span className="mf-mono" style={{ fontSize: 11, fontWeight: 600 }}>{s.n}</span></div>
                    <div style={{ height: 6, background: s.c, borderRadius: 3 }} />
                    <div className="mf-ink4 mf-mono" style={{ fontSize: 10, minHeight: 12 }}>{s.note}</div>
                  </div>
                ))}
              </div>
              <hr className="mf-rule" style={{ margin: '14px 0 10px' }} />
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 12.5 }}>Needs your attention</div>
              <div className="mf-col mf-g6">
                {[
                  { dot: MF.warn,   t: 'Alvarez — CORA response overdue 2d',               act: 'Draft reply', to: 'matter/alvarez' },
                  { dot: MF.accent, t: 'Williams — settlement offer $225k from opposing',  act: 'Review',      to: 'matter/williams' },
                  { dot: '#8a6a2d', t: 'In re: Aurora class — co-counsel signoff needed',  act: 'Approve',     to: 'matter/aurora' },
                  { dot: MF.ink3,   t: 'Moreno — EEOC right-to-sue, 90d clock starts',     act: 'Calendar it', to: 'calendar' },
                ].map((r, i) => (
                  <div key={i} className="mf-row mf-g8 mf-ai mf-p8" style={{ background: MF.bg2, borderRadius: 6, cursor: 'pointer' }} onClick={() => go(r.to)}>
                    <span className="mf-dot" style={{ background: r.dot }} />
                    <div style={{ fontSize: 12, flex: 1 }}>{r.t}</div>
                    <Btn sm>{r.act}</Btn>
                  </div>
                ))}
              </div>
            </div>

            <div className="mf-card" style={{ width: 340 }}>
              <div className="mf-p12 mf-hl" style={{ fontWeight: 600 }}>Activity</div>
              <div className="mf-col mf-p10 mf-g10">
                {[
                  ['gavel',  'PACER',     'Motion to dismiss filed — Patel',      '2h'],
                  ['mail',   'Email',     'Aurora CAO — settlement posture',      '3h'],
                  ['video',  'Evidence',  '3 body-cam clips synced — Alvarez',    '5h'],
                  ['sms',    'SMS',       'Client reply — Alvarez',               '6h'],
                  ['check',  'Task',      'R. Kim completed CGIA draft',          'yest.'],
                  ['dollar', 'Trust',     'Deposit $425,000 — Rivera',            'yest.'],
                  ['bolt',   'Automation','§1983 onboarding ran on new lead',     '2d'],
                ].map((a, i) => (
                  <div key={i} className="mf-row mf-g8 mf-as">
                    <Icon n={a[0]} size={13} style={{ color: MF.ink4, marginTop: 2 }} />
                    <div className="mf-col mf-flex1" style={{ gap: 1 }}>
                      <div className="mf-row mf-g6 mf-ai"><span className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>{a[1]}</span><span className="mf-ink4" style={{ fontSize: 10 }}>·</span><span className="mf-ink4" style={{ fontSize: 10 }}>{a[3]}</span></div>
                      <div style={{ fontSize: 11.5 }}>{a[2]}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    </AppShell>
  );
}

// ── MATTERS list ─────────────────────────────────────────────────────────────
function PageMatters({ go }) {
  const rows = [
    { id: 'alvarez',  name: 'Alvarez v. Aurora PD',   area: '§1983',      lead: 'JM', stage: 'Discovery',   trust: '$5,000',   fee: 'contingent', deadline: '19d', dot: '#3d83b8' },
    { id: 'williams', name: 'Williams v. Denver',     area: '§1983',      lead: 'JM', stage: 'Dispositive', trust: '$0',       fee: 'contingent', deadline: '22d', dot: '#3d83b8' },
    { id: 'patel',    name: 'Patel — FHA',            area: 'Housing',    lead: 'RK', stage: 'Retained',    trust: '$4,120',   fee: 'hourly',     deadline: '35d', dot: '#2d8a5f' },
    { id: 'moreno',   name: 'Moreno — CADA',          area: 'Employment', lead: 'JM', stage: 'Pre-suit',    trust: '$2,500',   fee: 'hybrid',     deadline: '83d', dot: '#b6623d' },
    { id: 'chen',     name: 'Chen — ADA transit',     area: 'ADA',        lead: 'JM', stage: 'Discovery',   trust: '$0',       fee: 'contingent', deadline: '—',   dot: '#3d83b8' },
    { id: 'aurora',   name: 'In re: Aurora class',    area: 'Class',      lead: 'LK', stage: 'Cert',        trust: '$0',       fee: 'contingent', deadline: '19d', dot: '#8a6a2d' },
    { id: 'nguyen',   name: 'Nguyen — DUI',           area: 'Criminal',   lead: 'MG', stage: 'Pretrial',    trust: '$3,500',   fee: 'flat',       deadline: '12d', dot: '#7a5aa6' },
    { id: 'rodriguez',name: 'Rodriguez — FHA',        area: 'Housing',    lead: 'RK', stage: 'Pre-suit',    trust: '$1,200',   fee: 'hourly',     deadline: '6d',  dot: '#2d8a5f' },
    { id: 'ellis',    name: 'Ellis — IDEA',           area: 'Education',  lead: 'JM', stage: 'Pre-suit',    trust: '$0',       fee: 'contingent', deadline: '—',   dot: '#3a8a7a' },
    { id: 'boaz',     name: 'Boaz — §1983 prisoner',  area: '§1983',      lead: 'JM', stage: 'Intake',      trust: '$0',       fee: 'pro bono',   deadline: '—',   dot: '#3d83b8' },
    { id: 'rivera',   name: 'Rivera v. Lakewood',     area: '§1983',      lead: 'JM', stage: 'Settled',     trust: '$425,000', fee: 'contingent', deadline: 'distribute', dot: '#3d83b8' },
    { id: 'jenner',   name: 'Jenner — employment',    area: 'Employment', lead: 'LK', stage: 'Closed',      trust: '$0',       fee: 'hourly',     deadline: '—',   dot: '#b6623d' },
  ];
  const [filter, setFilter] = React.useState('All');
  const [view, setView] = React.useState('Table');
  const shown = filter === 'All' ? rows : rows.filter(r => r.area === filter || (filter === '§1983' && r.area === '§1983'));
  return (
    <AppShell path="matters" go={go} topbar={
      <AppTopBar
        crumbs="MATTERS"
        title="All matters"
        sub={<span className="mf-ink3">{rows.filter(r => r.stage !== 'Closed').length} open · 87 closed</span>}
        right={<>
          <GlobalSearch />
          <Seg options={['Table', 'Kanban', 'Cards']} value={view} onChange={setView} icons={['inbox', 'layers', 'folder']} />
          <Btn icon="filter">Filter</Btn>
          <Btn primary icon="plus">New matter</Btn>
        </>}
        below={<div className="mf-row mf-g6 mf-ai" style={{ padding: '0 18px 10px' }}>
          {[['All', 34], ['§1983', 18], ['Employment', 6], ['Housing', 4], ['Criminal', 3], ['Class', 2]].map(([l, n]) => (
            <Chip key={l} fill={filter === l} style={{ cursor: 'pointer' }}><span onClick={() => setFilter(l)}>{l} <span style={{ opacity: .6, marginLeft: 4 }}>{n}</span></span></Chip>
          ))}
          <Chip ghost style={{ cursor: 'pointer' }}>+ saved view</Chip>
        </div>}
      />
    }>
      {view === 'Kanban' ? <MattersKanban rows={shown} go={go} /> :
       view === 'Cards'  ? <MattersCards  rows={shown} go={go} /> :
      <>
      <div className="mf-flex1" style={{ background: MF.card, overflow: 'auto', minHeight: 0 }}>
        <table className="mf-table">
          <thead><tr>
            <th style={{ width: 26 }}></th>
            <th>Matter</th>
            <th>Area</th>
            <th>Lead</th>
            <th>Stage</th>
            <th style={{ textAlign: 'right' }}>Trust</th>
            <th>Fee</th>
            <th>Next deadline</th>
            <th>Activity · 30d</th>
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} onClick={() => go(r.id === 'rivera' ? 'settlement/rivera' : 'matter/' + r.id)}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" style={{ accentColor: MF.ink }} /></td>
                <td>
                  <div className="mf-row mf-g8 mf-ai">
                    <span className="mf-dot" style={{ background: r.dot }} />
                    <span style={{ fontWeight: 500 }}>{r.name}</span>
                  </div>
                </td>
                <td><Chip style={{ fontSize: 10 }}>{r.area}</Chip></td>
                <td><Av initials={r.lead} /></td>
                <td><Chip style={{ fontSize: 10 }} ok={r.stage === 'Settled'} warn={r.stage === 'Closed'}>{r.stage}</Chip></td>
                <td className="mf-mono" style={{ textAlign: 'right' }}>{r.trust}</td>
                <td className="mf-mono mf-ink3" style={{ fontSize: 11 }}>{r.fee}</td>
                <td>
                  {r.deadline === '—'
                    ? <span className="mf-ink4">—</span>
                    : r.deadline === 'distribute'
                      ? <Chip accent>ready</Chip>
                      : <span className="mf-mono" style={{ fontSize: 11, color: parseInt(r.deadline) < 20 ? MF.warn : MF.ink }}>in {r.deadline}</span>}
                </td>
                <td>
                  <svg width="100" height="22" viewBox="0 0 100 22" className="app-spark">
                    {[3, 5, 2, 7, 4, 6, 3, 8, 5, 2, 6, 4, 7, 5].map((h, j) => (
                      <rect key={j} x={j * 7} y={20 - h * 1.6} width={5} height={h * 1.6} fill={r.dot} opacity={0.5 + (j / 28)} />
                    ))}
                  </svg>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mf-between mf-p8" style={{ background: MF.bg2, borderTop: `1px solid ${MF.line}` }}>
        <span className="mf-ink4 mf-mono" style={{ fontSize: 10.5 }}>{shown.length} of 34 shown · sorted by last activity</span>
        <div className="mf-row mf-g6"><Btn sm ghost>Group</Btn><Btn sm ghost>Sort</Btn><Btn sm ghost>Fields</Btn></div>
      </div>
      </>}
    </AppShell>
  );
}

// ── Matters · Kanban ────────────────────────────────────────────────────────
function MattersKanban({ rows, go }) {
  const stages = ['Intake', 'Pre-suit', 'Retained', 'Discovery', 'Dispositive', 'Pretrial', 'Cert', 'Settled', 'Closed'];
  const byStage = stages.map(s => ({ s, items: rows.filter(r => r.stage === s) }));
  const visible = byStage.filter(g => g.items.length > 0);
  return (
    <div className="mf-flex1" style={{ overflow: 'auto', minHeight: 0, background: MF.bg }}>
      <div className="mf-row" style={{ padding: 16, gap: 12, alignItems: 'flex-start', minHeight: '100%' }}>
        {visible.map(g => (
          <div key={g.s} className="mf-col" style={{ width: 260, flexShrink: 0, gap: 8 }}>
            <div className="mf-between mf-ai" style={{ padding: '0 4px' }}>
              <div className="mf-row mf-g6 mf-ai">
                <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{g.s}</span>
                <span className="mf-ink4 mf-mono" style={{ fontSize: 10.5 }}>{g.items.length}</span>
              </div>
              <Icon n="plus" size={12} style={{ color: MF.ink4, cursor: 'pointer' }} />
            </div>
            <div className="mf-col" style={{ gap: 8 }}>
              {g.items.map(r => (
                <div key={r.id} className="mf-card mf-p10 app-card-hover"
                     style={{ cursor: 'pointer' }}
                     onClick={() => go(r.id === 'rivera' ? 'settlement/rivera' : 'matter/' + r.id)}>
                  <div className="mf-row mf-g6 mf-ai">
                    <span className="mf-dot" style={{ background: r.dot }} />
                    <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  </div>
                  <div className="mf-row mf-g6 mf-ai" style={{ marginTop: 8 }}>
                    <Chip style={{ fontSize: 10 }}>{r.area}</Chip>
                    <Chip ghost style={{ fontSize: 10 }}>{r.fee}</Chip>
                  </div>
                  <div className="mf-between mf-ai" style={{ marginTop: 10 }}>
                    <div className="mf-row mf-g4 mf-ai">
                      <Av initials={r.lead} />
                      {r.trust !== '$0' && <span className="mf-mono mf-ink3" style={{ fontSize: 10.5 }}>trust {r.trust}</span>}
                    </div>
                    {r.deadline === '—' ? <span className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>—</span>
                      : r.deadline === 'distribute' ? <Chip accent style={{ fontSize: 10 }}>distribute</Chip>
                      : <span className="mf-mono" style={{ fontSize: 10.5, color: parseInt(r.deadline) < 20 ? MF.warn : MF.ink3 }}>in {r.deadline}</span>}
                  </div>
                  <svg width="100%" height="18" viewBox="0 0 240 18" style={{ marginTop: 8, display: 'block' }}>
                    {[3, 5, 2, 7, 4, 6, 3, 8, 5, 2, 6, 4, 7, 5, 6, 3].map((h, j) => (
                      <rect key={j} x={j * 15 + 2} y={16 - h * 1.4} width={10} height={h * 1.4} fill={r.dot} opacity={0.35 + (j / 28)} />
                    ))}
                  </svg>
                </div>
              ))}
              <div className="mf-p8" style={{ border: `1px dashed ${MF.line2}`, borderRadius: 6, textAlign: 'center', fontSize: 11, color: MF.ink4, cursor: 'pointer' }}>+ add matter</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Matters · Cards ─────────────────────────────────────────────────────────
function MattersCards({ rows, go }) {
  return (
    <div className="mf-flex1" style={{ overflow: 'auto', minHeight: 0, background: MF.bg }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, padding: 16 }}>
        {rows.map(r => (
          <div key={r.id} className="mf-card mf-p12 app-card-hover" style={{ cursor: 'pointer' }}
               onClick={() => go(r.id === 'rivera' ? 'settlement/rivera' : 'matter/' + r.id)}>
            <div className="mf-between mf-ai">
              <Chip style={{ fontSize: 10 }} dot={r.dot}>{r.area}</Chip>
              <Chip style={{ fontSize: 10 }} ok={r.stage === 'Settled'} warn={r.stage === 'Closed'} accent={r.stage === 'Discovery'}>{r.stage}</Chip>
            </div>
            <div className="app-h1" style={{ fontSize: 15, marginTop: 10, lineHeight: 1.25 }}>{r.name}</div>
            <div className="mf-ink3 mf-mono" style={{ fontSize: 10.5, marginTop: 2 }}>lead · {r.lead === 'JM' ? 'Jane Marsh' : r.lead === 'RK' ? 'Rachel Kim' : r.lead === 'LK' ? 'Leo Kosloski' : 'Marco Guerra'}</div>
            <hr className="mf-rule" style={{ margin: '10px 0' }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              <div><div className="mf-ink4" style={{ fontSize: 9.5, textTransform: 'uppercase' }}>Trust</div><div className="mf-mono" style={{ fontSize: 11, fontWeight: 600 }}>{r.trust}</div></div>
              <div><div className="mf-ink4" style={{ fontSize: 9.5, textTransform: 'uppercase' }}>Fee</div><div className="mf-mono" style={{ fontSize: 11 }}>{r.fee}</div></div>
              <div><div className="mf-ink4" style={{ fontSize: 9.5, textTransform: 'uppercase' }}>Next</div>
                {r.deadline === '—' ? <div className="mf-ink4" style={{ fontSize: 11 }}>—</div>
                 : r.deadline === 'distribute' ? <div className="mf-mono" style={{ fontSize: 10.5, color: MF.accent, fontWeight: 600 }}>distribute</div>
                 : <div className="mf-mono" style={{ fontSize: 11, fontWeight: 600, color: parseInt(r.deadline) < 20 ? MF.warn : MF.ink }}>in {r.deadline}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { MattersKanban, MattersCards });

Object.assign(window, { AppShell, AppTopBar, GlobalSearch, PageToday, PageMatters });
