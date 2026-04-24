// app-time.jsx — Time logging system (v2)
//
// Replaces the placeholder PageTime with a day-reconciliation workspace,
// mounts a global modal host, and ships a floating multi-timer widget.
//
//   openTimeEntry({ preset })      → opens modal anywhere
//   startTimer({ matterId, label }) → starts a timer, floats widget
//   pauseTimer(id) / stopTimer(id)  → manages running timers
//
// All triggered by plain window CustomEvents so any component can dispatch.

// ── Timer bus ─────────────────────────────────────────────────────────────
// A singleton in-memory + localStorage-backed store.

const __TIMER_KEY = 'kos-timers-v1';

function readTimers() {
  try { return JSON.parse(localStorage.getItem(__TIMER_KEY) || '[]'); } catch (e) { return []; }
}
function writeTimers(list) {
  try { localStorage.setItem(__TIMER_KEY, JSON.stringify(list)); } catch (e) {}
  window.dispatchEvent(new CustomEvent('kos-timers-changed'));
}

function useTimers() {
  const [timers, setTimers] = React.useState(() => readTimers());
  React.useEffect(() => {
    const sync = () => setTimers(readTimers());
    window.addEventListener('kos-timers-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('kos-timers-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  // Tick once per second so elapsed updates
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const anyRunning = timers.some(t => t.running);
    if (!anyRunning) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [timers]);
  return timers;
}

function elapsedOf(t) {
  return t.accumMs + (t.running ? (Date.now() - t.startedAt) : 0);
}

function msToHMS(ms) {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map(n => String(n).padStart(2, '0')).join(':');
}

function openTimeEntry(preset) {
  window.dispatchEvent(new CustomEvent('open-time-entry', { detail: { preset: preset || {} } }));
}

function startTimer({ matterId, label }) {
  const list = readTimers();
  const id = 'tm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  list.push({
    id, matterId: matterId || 'alvarez', label: label || 'Untitled work',
    accumMs: 0, startedAt: Date.now(), running: true,
  });
  writeTimers(list);
  window.dispatchEvent(new CustomEvent('kos-toast', { detail: { msg: 'Timer started · ' + (label || 'Untitled') } }));
  return id;
}

function pauseTimer(id) {
  const list = readTimers().map(t => {
    if (t.id !== id) return t;
    if (!t.running) return t;
    return { ...t, running: false, accumMs: t.accumMs + (Date.now() - t.startedAt), startedAt: null };
  });
  writeTimers(list);
}

function resumeTimer(id) {
  const list = readTimers().map(t => t.id === id && !t.running ? { ...t, running: true, startedAt: Date.now() } : t);
  writeTimers(list);
}

function stopTimer(id) {
  const list = readTimers();
  const t = list.find(x => x.id === id);
  if (!t) return;
  const ms = t.accumMs + (t.running ? (Date.now() - t.startedAt) : 0);
  writeTimers(list.filter(x => x.id !== id));
  openTimeEntry({
    matterId: t.matterId,
    activity: t.label,
    mode: 'hours',
    hours: Math.max(0.1, Math.round((ms / 3600000) * 10) / 10),
    source: 'stopped timer (' + msToHMS(ms) + ')',
  });
}

function discardTimer(id) {
  writeTimers(readTimers().filter(x => x.id !== id));
}

// expose globally so buttons anywhere can call
Object.assign(window, { openTimeEntry, startTimer, pauseTimer, resumeTimer, stopTimer, discardTimer });


// ── Global modal host ─────────────────────────────────────────────────────
function TimeEntryHost() {
  const [open, setOpen] = React.useState(null);
  React.useEffect(() => {
    const h = (e) => setOpen({ preset: (e.detail && e.detail.preset) || {} });
    window.addEventListener('open-time-entry', h);
    return () => window.removeEventListener('open-time-entry', h);
  }, []);
  if (!open) return null;
  return <TimeEntryModal initial={open.preset} onClose={() => setOpen(null)}
                         onSave={() => window.dispatchEvent(new CustomEvent('kos-toast', { detail: { msg: 'Time entry saved' } }))} />;
}


// ── Floating multi-timer widget ───────────────────────────────────────────
function FloatingTimer() {
  const timers = useTimers();
  const [collapsed, setCollapsed] = React.useState(false);
  const [minimized, setMinimized] = React.useState(false);

  // Auto-show on any running; stay hidden if no timers
  if (timers.length === 0) {
    return (
      <button
        onClick={() => {
          // Offer a quick-start: alvarez with generic label
          startTimer({ matterId: 'alvarez', label: 'New session' });
        }}
        title="Start a timer (press T)"
        style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 120,
          width: 44, height: 44, borderRadius: 22,
          background: '#fff', border: `1px solid ${MF.line}`,
          boxShadow: '0 6px 18px -6px rgba(12,24,38,.22), 0 2px 4px rgba(12,24,38,.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: MF.ink2, cursor: 'pointer',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = MF.accent; e.currentTarget.style.borderColor = MF.accent; }}
        onMouseLeave={e => { e.currentTarget.style.color = MF.ink2; e.currentTarget.style.borderColor = MF.line; }}
      >
        <Icon n="clock" size={18} />
      </button>
    );
  }

  const running = timers.filter(t => t.running);
  const totalMs = timers.reduce((s, t) => s + elapsedOf(t), 0);

  if (minimized) {
    return (
      <button onClick={() => setMinimized(false)}
        style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 120,
          padding: '8px 12px', borderRadius: 20,
          background: running.length ? '#c13c3c' : MF.ink, color: '#fff',
          border: 'none', boxShadow: '0 8px 22px -6px rgba(12,24,38,.35)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: MF.fMono, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
        }}>
        <span style={{ width: 7, height: 7, borderRadius: 4, background: '#fff', animation: running.length ? 'kos-pulse 1.4s ease-in-out infinite' : 'none' }} />
        {msToHMS(totalMs)}
        <span style={{ opacity: .7, fontSize: 10.5, fontWeight: 400 }}>· {timers.length} timer{timers.length > 1 ? 's' : ''}</span>
      </button>
    );
  }

  return (
    <>
      <style>{`
        @keyframes kos-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
      `}</style>
      <div style={{
        position: 'fixed', right: 20, bottom: 20, zIndex: 120,
        width: 340, background: '#fff', borderRadius: 12,
        border: `1px solid ${MF.line}`,
        boxShadow: '0 14px 36px -10px rgba(12,24,38,.28), 0 4px 12px rgba(12,24,38,.08)',
        overflow: 'hidden', fontFamily: MF.fUI,
      }}>
        {/* Header */}
        <div style={{
          padding: '10px 12px 10px 14px',
          background: running.length
            ? 'linear-gradient(180deg, #fef3f1, #fce8e5)'
            : 'linear-gradient(180deg, #f7f9fc, #eff3f9)',
          borderBottom: `1px solid ${MF.line}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: 4,
            background: running.length ? '#c13c3c' : MF.ink3,
            animation: running.length ? 'kos-pulse 1.4s ease-in-out infinite' : 'none',
          }} />
          <div style={{ fontSize: 12, fontWeight: 600, color: MF.ink, letterSpacing: '-.005em' }}>
            {running.length ? `${running.length} timer${running.length > 1 ? 's' : ''} running` : 'Timers'}
          </div>
          <div style={{ flex: 1, textAlign: 'right', fontFamily: MF.fMono, fontSize: 12, fontWeight: 600, color: MF.ink }}>
            {msToHMS(totalMs)}
          </div>
          <button onClick={() => setCollapsed(c => !c)}
            style={iconBtnStyle}
            title={collapsed ? 'Expand' : 'Collapse'}>
            <Icon n={collapsed ? 'plus' : 'minus'} size={11} />
          </button>
          <button onClick={() => setMinimized(true)} style={iconBtnStyle} title="Minimize">
            <Icon n="close" size={11} />
          </button>
        </div>

        {/* Body */}
        {!collapsed && (
          <div className="mf-col" style={{ padding: 8, gap: 6, maxHeight: 360, overflowY: 'auto' }}>
            {timers.map(t => {
              const m = (window.TIME_MATTERS || []).find(x => x.id === t.matterId) || { name: t.matterId, dot: MF.ink3, area: '' };
              const ms = elapsedOf(t);
              return (
                <div key={t.id} style={{
                  padding: '8px 10px', borderRadius: 8,
                  border: `1px solid ${t.running ? 'color-mix(in oklch, #c13c3c 35%, #fff)' : MF.line}`,
                  background: t.running ? '#fff9f8' : '#fafaf7',
                }}>
                  <div className="mf-between mf-ai" style={{ gap: 8 }}>
                    <div className="mf-col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                      <div className="mf-row mf-g6 mf-ai" style={{ minWidth: 0 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 3, background: m.dot, flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: MF.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
                      </div>
                      <div className="mf-ink3" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</div>
                    </div>
                    <div style={{
                      fontFamily: MF.fMono, fontSize: 14, fontWeight: 600,
                      color: t.running ? '#c13c3c' : MF.ink, letterSpacing: '-.01em',
                      minWidth: 70, textAlign: 'right',
                    }}>{msToHMS(ms)}</div>
                  </div>
                  <div className="mf-row mf-g4" style={{ marginTop: 6 }}>
                    {t.running ? (
                      <button onClick={() => pauseTimer(t.id)} style={timerBtn('#c13c3c', true)}>Pause</button>
                    ) : (
                      <button onClick={() => resumeTimer(t.id)} style={timerBtn(MF.accent, true)}>Resume</button>
                    )}
                    <button onClick={() => stopTimer(t.id)} style={timerBtn(MF.ink2)}>Stop &amp; log…</button>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => { if (confirm('Discard this timer?')) discardTimer(t.id); }} style={timerBtn(MF.ink3)} title="Discard">
                      <Icon n="close" size={10} />
                    </button>
                  </div>
                </div>
              );
            })}

            <button onClick={() => {
              const label = prompt('What are you working on?');
              if (label) startTimer({ matterId: 'alvarez', label });
            }} style={{
              marginTop: 2, padding: '6px 8px', fontSize: 11.5, fontWeight: 500,
              background: 'transparent', border: `1px dashed ${MF.line}`, borderRadius: 7,
              color: MF.ink3, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Icon n="plus" size={11} /> Start another timer
            </button>
          </div>
        )}
      </div>
    </>
  );
}

const iconBtnStyle = {
  width: 20, height: 20, borderRadius: 5, border: 'none', background: 'transparent',
  color: MF.ink3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function timerBtn(color, filled) {
  return {
    padding: '3px 8px', fontSize: 10.5, fontWeight: 600,
    border: `1px solid ${filled ? color : MF.line}`,
    background: filled ? color : '#fff',
    color: filled ? '#fff' : color,
    borderRadius: 6, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontFamily: MF.fUI,
  };
}


// ── Toast system (tiny) ───────────────────────────────────────────────────
function KosToaster() {
  const [toasts, setToasts] = React.useState([]);
  React.useEffect(() => {
    const h = (e) => {
      const id = Date.now() + Math.random();
      setToasts(t => [...t, { id, msg: e.detail.msg }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2400);
    };
    window.addEventListener('kos-toast', h);
    return () => window.removeEventListener('kos-toast', h);
  }, []);
  return (
    <div style={{
      position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)',
      zIndex: 200, display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: '8px 14px', borderRadius: 8,
          background: MF.ink, color: '#fff', fontSize: 12, fontWeight: 500,
          boxShadow: '0 8px 20px -4px rgba(0,0,0,.3)',
          animation: 'kos-toast-in .2s ease-out',
        }}>{t.msg}</div>
      ))}
      <style>{`@keyframes kos-toast-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }`}</style>
    </div>
  );
}


// ── PageTime v2 — day-reconciliation workspace ───────────────────────────
function PageTime2({ go }) {
  const timers = useTimers();
  const [captured, setCaptured] = React.useState(() => DEFAULT_CAPTURED);
  const [day, setDay] = React.useState('Today');

  const dismissCaptured = (id) => setCaptured(c => c.filter(x => x.id !== id));
  const logCaptured = (c) => {
    openTimeEntry(c.preset);
    // Don't auto-dismiss — user may cancel. Let the saved event handle it.
  };

  const totalCapturedMin = captured.reduce((s, c) => s + c.mins, 0);
  const unaccountedMin = 8 * 60 - 6.4 * 60 - totalCapturedMin;

  return (
    <AppShell path="time" go={go} topbar={
      <AppTopBar
        crumbs="TIME"
        title="Time · today"
        sub={<span className="mf-ink3">Thursday Apr 23 · 6.4h logged · {captured.length} session{captured.length !== 1 ? 's' : ''} captured · {(unaccountedMin / 60).toFixed(1)}h unaccounted</span>}
        right={<>
          <GlobalSearch />
          <Seg options={['Day', 'Week', 'Month']} value={day} onChange={setDay} />
          <Btn icon="clock" onClick={() => startTimer({ matterId: 'alvarez', label: 'New session' })}>Start timer</Btn>
          <Btn primary icon="plus" onClick={() => openTimeEntry({})}>Log time</Btn>
        </>}
      />
    }>
      <div className="mf-scroll" style={{ overflowY: 'auto', flex: 1 }}>
        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 16, alignItems: 'flex-start' }}>

          {/* ─── LEFT: day reconciliation ─── */}
          <div className="mf-col mf-g16">

            {/* Day timeline strip */}
            <DayTimeline captured={captured} />

            {/* Captured sessions */}
            <div className="mf-card">
              <div className="mf-between mf-p12 mf-hl">
                <div className="mf-row mf-g10 mf-ai">
                  <div style={{ fontWeight: 600 }}>Auto-captured activity</div>
                  <Chip accent>{captured.length}</Chip>
                  <span className="mf-ink3" style={{ fontSize: 11.5 }}>· one-click to log with pre-drafted narrative</span>
                </div>
                <div className="mf-row mf-g6">
                  <Btn sm ghost>Rules</Btn>
                  <Btn sm ghost icon="filter">All sources</Btn>
                </div>
              </div>
              <div>
                {captured.map((c, i) => (
                  <CapturedRow key={c.id} c={c} last={i === captured.length - 1}
                               onLog={() => logCaptured(c)} onDismiss={() => dismissCaptured(c.id)} />
                ))}
                {captured.length === 0 && (
                  <div className="mf-ink3" style={{ padding: 20, fontSize: 12, textAlign: 'center' }}>
                    All caught up. ✓ Your tracked activity is reconciled for today.
                  </div>
                )}
              </div>
            </div>

            {/* Logged entries — today */}
            <div className="mf-card">
              <div className="mf-between mf-p12 mf-hl">
                <div style={{ fontWeight: 600 }}>Entries · today</div>
                <span className="mf-ink4 mf-mono" style={{ fontSize: 10.5 }}>6.4h · 5.6h billable · $3,080 WIP</span>
              </div>
              <table className="mf-table">
                <thead><tr><th>When</th><th>Matter</th><th>Activity</th><th>Hours</th><th>Amount</th><th>Source</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {TODAY_ENTRIES.map((r, i) => (
                    <tr key={i} style={{ cursor: 'pointer' }}
                        onClick={() => openTimeEntry({ matterId: r.matterId, activity: r.activity, hours: r.hours, narrative: r.narrative, mode: 'hours' })}>
                      <td className="mf-mono" style={{ fontSize: 11 }}>{r.when}</td>
                      <td><MatterCell id={r.matterId} /></td>
                      <td>{r.activity}</td>
                      <td className="mf-mono" style={{ textAlign: 'right' }}>{fmtHours(r.hours)}</td>
                      <td className="mf-mono" style={{ fontWeight: 600 }}>{r.amount}</td>
                      <td><SourceChip s={r.source} /></td>
                      <td>{r.billable ? <Chip ok>bill</Chip> : <Chip ghost>track</Chip>}</td>
                      <td><span className="mf-link" style={{ fontSize: 11 }}>Edit →</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Week utilization */}
            <div className="mf-card mf-p14">
              <div className="mf-between">
                <div style={{ fontWeight: 600 }}>This week · daily hours</div>
                <span className="mf-ink4 mf-mono" style={{ fontSize: 10.5 }}>Mon–Sun · goal 8h/day · 33.6h logged</span>
              </div>
              <div className="mf-row" style={{ gap: 12, marginTop: 14, alignItems: 'flex-end', height: 120 }}>
                {WEEK.map((d, i) => (
                  <div key={i} className="mf-col mf-flex1" style={{ alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 10.5, fontFamily: MF.fMono, color: d.today ? MF.accent : MF.ink3, fontWeight: d.today ? 600 : 400 }}>{d.h.toFixed(1)}</div>
                    <div style={{ position: 'relative', width: '100%', height: 88, background: MF.bg2, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${(d.billable / 10) * 100}%`, background: MF.accent, opacity: d.today ? 1 : .75 }} />
                      <div style={{ position: 'absolute', bottom: `${(d.billable / 10) * 100}%`, left: 0, right: 0, height: `${((d.h - d.billable) / 10) * 100}%`, background: `color-mix(in oklch, ${MF.accent} 35%, ${MF.bg2})`, opacity: d.today ? 1 : .75 }} />
                      {/* 8h goal line */}
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '80%', borderTop: `1px dashed ${MF.ink4}` }} />
                    </div>
                    <div style={{ fontSize: 10.5, color: d.today ? MF.ink : MF.ink3, fontWeight: d.today ? 600 : 400 }}>{d.day}</div>
                  </div>
                ))}
              </div>
              <div className="mf-row mf-g12 mf-ai" style={{ marginTop: 10, fontSize: 10.5 }}>
                <div className="mf-row mf-g4 mf-ai"><span style={{ width: 8, height: 8, background: MF.accent, borderRadius: 2 }} />Billable</div>
                <div className="mf-row mf-g4 mf-ai"><span style={{ width: 8, height: 8, background: `color-mix(in oklch, ${MF.accent} 35%, ${MF.bg2})`, borderRadius: 2 }} />Tracked (contingent)</div>
                <div className="mf-row mf-g4 mf-ai"><span style={{ width: 16, height: 0, borderTop: `1px dashed ${MF.ink4}` }} />8h goal</div>
              </div>
            </div>
          </div>

          {/* ─── RIGHT rail ─── */}
          <div className="mf-col mf-g12" style={{ position: 'sticky', top: 0 }}>
            {/* Today KPIs */}
            <div className="mf-card mf-p14">
              <div className="mf-ink4" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>Today</div>
              <div className="mf-row mf-g4" style={{ marginTop: 6, alignItems: 'baseline' }}>
                <div className="app-h1" style={{ fontSize: 28 }}>6.4</div>
                <div className="mf-ink3" style={{ fontSize: 13, fontWeight: 500 }}>h logged</div>
              </div>
              <div className="mf-ink3" style={{ fontSize: 11.5 }}>5.6h billable · $3,080 WIP</div>

              {/* Reconciliation meter */}
              <div style={{ marginTop: 12, height: 10, background: MF.bg2, borderRadius: 5, overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: '40%', background: MF.accent }} title="Logged · 6.4h" />
                <div style={{ width: '28%', background: `color-mix(in oklch, ${MF.accent} 45%, #fff)` }} title="Captured · 1.4h suggested" />
                <div style={{ width: '8%', background: '#e8b94a' }} title="Running timer" />
                <div style={{ width: '24%', background: `repeating-linear-gradient(45deg, ${MF.bg2}, ${MF.bg2} 3px, ${MF.line} 3px, ${MF.line} 6px)` }} title="Unaccounted" />
              </div>
              <div className="mf-row mf-g10" style={{ marginTop: 6, fontSize: 10.5, flexWrap: 'wrap' }}>
                <span className="mf-ink3"><span style={{ display: 'inline-block', width: 8, height: 8, background: MF.accent, borderRadius: 2, marginRight: 4 }} />logged</span>
                <span className="mf-ink3"><span style={{ display: 'inline-block', width: 8, height: 8, background: `color-mix(in oklch, ${MF.accent} 45%, #fff)`, borderRadius: 2, marginRight: 4 }} />captured</span>
                <span className="mf-ink3"><span style={{ display: 'inline-block', width: 8, height: 8, background: '#e8b94a', borderRadius: 2, marginRight: 4 }} />running</span>
                <span className="mf-ink3"><span style={{ display: 'inline-block', width: 8, height: 8, background: MF.line, borderRadius: 2, marginRight: 4 }} />unaccounted</span>
              </div>
            </div>

            {/* Month goal */}
            <div className="mf-card mf-p14">
              <div className="mf-ink4" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>April · billable target</div>
              <div className="mf-row mf-g4" style={{ marginTop: 6, alignItems: 'baseline' }}>
                <div className="app-h1" style={{ fontSize: 28 }}>118.2</div>
                <div className="mf-ink3" style={{ fontSize: 13 }}>/ 160h</div>
              </div>
              <div className="mf-ink3" style={{ fontSize: 11.5 }}>74% · 23 days in · on pace</div>
              <div style={{ marginTop: 10, height: 6, background: MF.bg2, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: '74%', height: '100%', background: MF.accent }} />
              </div>
              <div className="mf-row mf-g8" style={{ marginTop: 10, fontSize: 11 }}>
                <div className="mf-col mf-flex1" style={{ gap: 2 }}>
                  <span className="mf-ink4" style={{ fontSize: 10 }}>Hourly</span>
                  <span className="mf-mono" style={{ fontWeight: 600 }}>46.2h</span>
                </div>
                <div className="mf-col mf-flex1" style={{ gap: 2 }}>
                  <span className="mf-ink4" style={{ fontSize: 10 }}>Contingent</span>
                  <span className="mf-mono" style={{ fontWeight: 600 }}>68.4h</span>
                </div>
                <div className="mf-col mf-flex1" style={{ gap: 2 }}>
                  <span className="mf-ink4" style={{ fontSize: 10 }}>Flat / pro-bono</span>
                  <span className="mf-mono" style={{ fontWeight: 600 }}>3.6h</span>
                </div>
              </div>
            </div>

            {/* Matter totals today */}
            <div className="mf-card mf-p12">
              <div className="mf-between" style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600 }}>Today by matter</div>
                <span className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>tap to filter</span>
              </div>
              <div className="mf-col mf-g6">
                {MATTER_TODAY.map(m => (
                  <div key={m.id} className="mf-row mf-g8 mf-ai" style={{ cursor: 'pointer' }}
                       onClick={() => openTimeEntry({ matterId: m.id })}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: m.dot }} />
                    <span style={{ fontSize: 11.5, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
                    <span className="mf-mono" style={{ fontSize: 11, fontWeight: 600 }}>{fmtHours(m.h)}</span>
                    <div style={{ width: 50, height: 4, background: MF.bg2, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, (m.h / 4) * 100)}%`, height: '100%', background: m.dot }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Unbilled WIP attention */}
            <div className="mf-card mf-p12" style={{ background: 'var(--blue-tint)', borderColor: 'var(--blue-200)' }}>
              <div className="mf-row mf-g6 mf-ai" style={{ marginBottom: 6 }}>
                <Icon n="bolt" size={12} style={{ color: 'var(--blue-700)' }} />
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--blue-900)' }}>Ready to bill</div>
              </div>
              <div className="mf-ink2" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                <b>$12,480</b> in billable hours on Williams v. Denver has cleared review and is ready to invoice.
              </div>
              <div className="mf-row mf-g6" style={{ marginTop: 8 }}>
                <Btn sm primary onClick={() => go('billing')}>Draft invoice →</Btn>
                <Btn sm ghost>Dismiss</Btn>
              </div>
            </div>

          </div>
        </div>
      </div>
    </AppShell>
  );
}


// ── Day timeline strip ────────────────────────────────────────────────────
function DayTimeline({ captured }) {
  // Fake day: 8a–7p shown as horizontal bar with segments
  const startHour = 8, endHour = 19;
  const span = endHour - startHour;
  return (
    <div className="mf-card mf-p14">
      <div className="mf-between mf-ai" style={{ marginBottom: 10 }}>
        <div className="mf-row mf-g8 mf-ai">
          <div style={{ fontWeight: 600 }}>Today · 8a–7p</div>
          <Chip accent>6.4h logged</Chip>
          <Chip warn>{(captured.reduce((s, c) => s + c.mins, 0) / 60).toFixed(1)}h captured</Chip>
          <Chip ghost>2.2h unaccounted</Chip>
        </div>
        <div className="mf-ink4 mf-mono" style={{ fontSize: 10.5 }}>click a gap to backfill</div>
      </div>

      {/* Hour ruler */}
      <div style={{ position: 'relative', height: 18, marginBottom: 4 }}>
        {[...Array(span + 1)].map((_, i) => {
          const hr = startHour + i;
          const label = hr === 12 ? '12p' : hr > 12 ? (hr - 12) + 'p' : hr + 'a';
          return (
            <div key={i} style={{
              position: 'absolute', left: `${(i / span) * 100}%`,
              transform: 'translateX(-50%)', fontSize: 10, fontFamily: MF.fMono, color: MF.ink4,
            }}>{label}</div>
          );
        })}
      </div>

      {/* Bars: three stacked lanes — logged, captured, meta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <TimelineLane label="Logged" rows={LOGGED_BARS} startHour={startHour} span={span} />
        <TimelineLane label="Captured" rows={CAPTURED_BARS} startHour={startHour} span={span} striped />
        <TimelineLane label="Timer" rows={TIMER_BARS} startHour={startHour} span={span} />
      </div>

      {/* Axis ticks */}
      <div style={{ position: 'relative', height: 4, marginTop: 2 }}>
        {[...Array(span + 1)].map((_, i) => (
          <div key={i} style={{
            position: 'absolute', left: `${(i / span) * 100}%`, top: 0,
            width: 1, height: 4, background: MF.line,
          }} />
        ))}
      </div>

      {/* Now indicator */}
      <div className="mf-ink3" style={{ fontSize: 10.5, marginTop: 8 }}>
        <span style={{ color: '#c13c3c', fontWeight: 600 }}>●</span> now 3:42p · next: Call w/ Alvarez @ 4:00p
      </div>
    </div>
  );
}

function TimelineLane({ label, rows, startHour, span, striped }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 68, fontSize: 10.5, fontFamily: MF.fMono, color: MF.ink3, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ position: 'relative', flex: 1, height: 26, background: MF.bg2, borderRadius: 4 }}>
        {rows.map((r, i) => {
          const left = ((r.start - startHour) / span) * 100;
          const width = ((r.end - r.start) / span) * 100;
          return (
            <div key={i} title={r.title} style={{
              position: 'absolute', left: `${left}%`, width: `${width}%`,
              top: 2, bottom: 2,
              background: striped
                ? `repeating-linear-gradient(45deg, ${r.color}, ${r.color} 4px, color-mix(in oklch, ${r.color} 35%, #fff) 4px, color-mix(in oklch, ${r.color} 35%, #fff) 8px)`
                : r.color,
              borderRadius: 3,
              display: 'flex', alignItems: 'center', padding: '0 6px',
              fontSize: 10, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
              cursor: 'pointer',
              boxShadow: r.live ? `0 0 0 2px #fff, 0 0 0 3px ${r.color}` : 'none',
            }}>{r.label}</div>
          );
        })}
      </div>
    </div>
  );
}


// ── Captured activity row ─────────────────────────────────────────────────
function CapturedRow({ c, last, onLog, onDismiss }) {
  const m = (window.TIME_MATTERS || []).find(x => x.id === c.matterId) || { name: c.matterId, dot: MF.ink3, area: '' };
  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: last ? 'none' : `1px solid ${MF.line}`,
      display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 100px 140px',
      gap: 12, alignItems: 'center',
    }} className="app-row-hover">
      {/* Source icon */}
      <div style={{
        width: 28, height: 28, borderRadius: 7,
        background: SOURCE_STYLE[c.source].bg, color: SOURCE_STYLE[c.source].fg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon n={SOURCE_STYLE[c.source].icon} size={13} />
      </div>

      {/* Content */}
      <div className="mf-col" style={{ gap: 2, minWidth: 0 }}>
        <div className="mf-row mf-g8 mf-ai" style={{ minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: MF.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {c.title}
          </span>
          <span className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>·</span>
          <span className="mf-ink3 mf-mono" style={{ fontSize: 10.5 }}>{c.when}</span>
          {c.high && <Chip warn style={{ fontSize: 9.5 }}>HIGH-VALUE</Chip>}
        </div>
        <div className="mf-row mf-g6 mf-ai" style={{ minWidth: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: m.dot, flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: MF.ink2, fontWeight: 500 }}>{m.name}</span>
          <span className="mf-ink4" style={{ fontSize: 10 }}>·</span>
          <span className="mf-ink3" style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {c.narrative}
          </span>
        </div>
      </div>

      {/* Suggested duration */}
      <div className="mf-col" style={{ alignItems: 'flex-end' }}>
        <div className="mf-mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--blue-700)' }}>{(c.mins / 60).toFixed(1)}h</div>
        <div className="mf-ink4" style={{ fontSize: 10 }}>suggested</div>
      </div>

      {/* Actions */}
      <div className="mf-row mf-g4" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onLog} style={{
          padding: '5px 10px', fontSize: 11.5, fontWeight: 600,
          background: 'var(--blue-500)', color: '#fff', border: 'none',
          borderRadius: 6, cursor: 'pointer',
        }}>Log →</button>
        <button onClick={onDismiss} style={{
          padding: '5px 8px', fontSize: 11.5, fontWeight: 500,
          background: '#fff', color: MF.ink3, border: `1px solid ${MF.line}`,
          borderRadius: 6, cursor: 'pointer',
        }}>Skip</button>
      </div>
    </div>
  );
}

function MatterCell({ id }) {
  const m = (window.TIME_MATTERS || []).find(x => x.id === id) || { name: id, dot: MF.ink3 };
  return (
    <span className="mf-row mf-g6 mf-ai">
      <span style={{ width: 6, height: 6, borderRadius: 3, background: m.dot }} />
      <span>{m.name.split(' ')[0]}</span>
    </span>
  );
}

function SourceChip({ s }) {
  const st = SOURCE_STYLE[s] || SOURCE_STYLE.manual;
  return (
    <span className="mf-row mf-g4 mf-ai" style={{ fontSize: 10.5, color: st.fg, background: st.bg, padding: '2px 6px', borderRadius: 4, display: 'inline-flex', fontWeight: 500 }}>
      <Icon n={st.icon} size={10} />{s}
    </span>
  );
}


// ── Data ──────────────────────────────────────────────────────────────────
const SOURCE_STYLE = {
  email:    { icon: 'mail',  bg: '#e8f0fa', fg: '#3461a0' },
  calendar: { icon: 'cal',   bg: '#f0eaf6', fg: '#6b4e7d' },
  call:     { icon: 'phone', bg: '#e9f4ec', fg: '#2f6b4e' },
  doc:      { icon: 'file',  bg: '#f5eedd', fg: '#8a6a2d' },
  task:     { icon: 'check', bg: '#eaf1f8', fg: '#3d83b8' },
  timer:    { icon: 'clock', bg: '#fde7e4', fg: '#c13c3c' },
  evidence: { icon: 'video', bg: '#f0eaf6', fg: '#6b4e7d' },
  manual:   { icon: 'plus',  bg: '#f3f1ea', fg: '#3a4251' },
};

const DEFAULT_CAPTURED = [
  { id: 'c1', source: 'email', when: '9:42a', matterId: 'alvarez',
    title: 'Email thread · RE: CGIA Notice of Claim',
    narrative: '3 messages w/ opposing counsel re: service & acceptance',
    mins: 18, high: false,
    preset: { matterId: 'alvarez', activity: 'Email — opposing counsel re: CGIA service',
              code: 'A107', source: 'email thread (9:42a)', mode: 'hours', hours: 0.3,
              narrative: 'Correspondence with City Attorney re: CGIA notice service; confirmed acceptance; clarified scope of included claims.' } },
  { id: 'c2', source: 'calendar', when: '10:00a', matterId: 'williams',
    title: 'Meet & confer · opposing counsel',
    narrative: 'Video call · discovery scope · 52 min attended',
    mins: 52, high: true,
    preset: { matterId: 'williams', activity: 'Meet & confer · discovery scope',
              code: 'A107', source: 'calendar event (10:00a)', mode: 'range', start: '10:00', end: '10:52',
              narrative: 'Met and conferred with defense counsel re: scope of body-cam discovery and search terms for email custodians.' } },
  { id: 'c3', source: 'doc', when: '11:15a–12:40p', matterId: 'alvarez',
    title: 'MS Word · Motion to Compel · v3',
    narrative: '1h 25m editing · 340 words added · 2 citations inserted',
    mins: 85, high: true,
    preset: { matterId: 'alvarez', activity: 'Motion to compel · draft revisions',
              code: 'A103', source: 'Word plugin', mode: 'hours', hours: 1.4,
              narrative: 'Revised motion to compel BWC production; incorporated Rule 26(b) proportionality framework; added citations to Williams v. PDO and Flagg v. Detroit.' } },
  { id: 'c4', source: 'call', when: '1:08p', matterId: 'moreno',
    title: 'Client call · Carmen Moreno',
    narrative: '22 min · status update + settlement posture',
    mins: 22, high: false,
    preset: { matterId: 'moreno', activity: 'Client call · status + settlement posture',
              code: 'A106', source: 'phone log', mode: 'hours', hours: 0.4,
              narrative: 'Phone conference with client re: case status and settlement authority; confirmed authority range.' } },
  { id: 'c5', source: 'evidence', when: '2:15p–3:00p', matterId: 'alvarez',
    title: 'Evidence viewer · BWC-4421 & 4422',
    narrative: 'Reviewed 45 min of BWC · 8 timeline markers added',
    mins: 45, high: false,
    preset: { matterId: 'alvarez', activity: 'Evidence review · BWC 4421/4422',
              code: 'A104', source: 'evidence viewer', mode: 'hours', hours: 0.8,
              narrative: 'Reviewed body-worn camera footage from Officers Reese and Kim covering first 45 min of incident; added timeline markers for key events.' } },
  { id: 'c6', source: 'task', when: '3:22p', matterId: 'aurora',
    title: 'Task completed · Class cert outline',
    narrative: '1h 20m estimated · outline for numerosity + commonality',
    mins: 80, high: false,
    preset: { matterId: 'aurora', activity: 'Class cert · outline brief',
              code: 'A103', source: 'completed task', mode: 'hours', hours: 1.3,
              narrative: 'Outlined class certification brief — Rule 23(a) numerosity, commonality, typicality, adequacy; flagged open issues for partner review.' } },
];

const TODAY_ENTRIES = [
  { when: '8:15a', matterId: 'alvarez', activity: 'Research · qualified immunity caselaw', hours: 1.2, amount: 'contingent', billable: false, source: 'timer',
    narrative: 'Researched Tenth Circuit qualified immunity standards for excessive-force claims post-Estate of Booker.' },
  { when: '10:52a', matterId: 'williams', activity: 'Meet & confer prep + attendance', hours: 1.0, amount: '$550', billable: true, source: 'calendar',
    narrative: 'Meet & confer re: discovery scope, custodians, ESI protocol.' },
  { when: '12:50p', matterId: 'alvarez', activity: 'Motion to compel · revisions', hours: 1.4, amount: 'contingent', billable: false, source: 'doc',
    narrative: 'Revised motion to compel BWC production; incorporated proportionality framework.' },
  { when: '1:32p', matterId: 'moreno', activity: 'Client call · status', hours: 0.4, amount: '$170', billable: true, source: 'call',
    narrative: 'Phone conference with client re: case status and settlement authority.' },
  { when: '2:10p', matterId: 'patel', activity: 'Intake consult · FHA', hours: 1.5, amount: '$825', billable: true, source: 'calendar',
    narrative: 'Initial intake consultation; evaluated HUD complaint viability and §3604 claims.' },
  { when: '3:30p', matterId: 'aurora', activity: 'Class cert · numerosity research', hours: 0.9, amount: 'contingent', billable: false, source: 'timer',
    narrative: 'Researched numerosity threshold authority in Tenth Circuit class actions.' },
];

const WEEK = [
  { day: 'M', h: 7.2, billable: 5.8, today: false },
  { day: 'T', h: 8.4, billable: 7.1, today: false },
  { day: 'W', h: 7.8, billable: 6.4, today: false },
  { day: 'T', h: 6.4, billable: 5.6, today: true },
  { day: 'F', h: 0, billable: 0, today: false },
  { day: 'S', h: 0, billable: 0, today: false },
  { day: 'S', h: 0, billable: 0, today: false },
];

const MATTER_TODAY = [
  { id: 'alvarez', name: 'Alvarez v. Aurora', h: 3.2, dot: '#3d83b8' },
  { id: 'williams', name: 'Williams v. Denver', h: 1.0, dot: '#3d83b8' },
  { id: 'aurora', name: 'In re: Aurora class', h: 0.9, dot: '#8a6a2d' },
  { id: 'patel', name: 'Patel (intake)', h: 1.5, dot: '#2d8a5f' },
  { id: 'moreno', name: 'Moreno v. State', h: 0.4, dot: '#b6623d' },
];

const LOGGED_BARS = [
  { start: 8.25, end: 9.45, color: '#3d83b8', label: 'Alvarez · QI research', title: 'Alvarez · qualified immunity research · 1.2h' },
  { start: 10.86, end: 11.86, color: '#3d83b8', label: 'Williams · M&C', title: 'Williams meet & confer · 1.0h' },
  { start: 12.83, end: 14.23, color: '#3d83b8', label: 'Alvarez · motion', title: 'Alvarez · motion revisions · 1.4h' },
  { start: 14.53, end: 14.93, color: '#b6623d', label: 'Moreno', title: 'Moreno client call · 0.4h' },
  { start: 14.16, end: 15.66, color: '#2d8a5f', label: 'Patel · intake', title: 'Patel intake · 1.5h' },
];
const CAPTURED_BARS = [
  { start: 9.7, end: 10.0, color: '#3d83b8', label: 'email', title: 'Captured: email re: CGIA · 0.3h' },
  { start: 11.25, end: 12.67, color: '#3d83b8', label: 'doc edits', title: 'Captured: motion edits · 1.4h' },
  { start: 13.13, end: 13.5, color: '#b6623d', label: 'call', title: 'Captured: Moreno call · 0.4h' },
  { start: 14.25, end: 15.0, color: '#3d83b8', label: 'evidence', title: 'Captured: BWC review · 0.8h' },
  { start: 15.37, end: 16.7, color: '#8a6a2d', label: 'aurora', title: 'Captured: Aurora outline · 1.3h' },
];
const TIMER_BARS = [
  { start: 15.7, end: 15.95, color: '#e8b94a', label: '● running · Alvarez', title: 'Running timer · Alvarez · 15 min', live: true },
];

// ── Wire up ───────────────────────────────────────────────────────────────
Object.assign(window, { PageTime: PageTime2, FloatingTimer, TimeEntryHost, KosToaster });
