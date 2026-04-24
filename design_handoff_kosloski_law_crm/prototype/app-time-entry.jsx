// app-time-entry.jsx — Time / billing entry modal.
//
// Opens from: Log time buttons, Start timer → Stop, Email → "Log time · 0.3h",
// Matter → Add time, Calendar event → Log from event.
//
// Signature bits for a civil-rights firm:
//   • Duration has three modes: Timer / Hours / Start→End. All round to 0.1h.
//   • Fee structure auto-adapts: contingent matters show "non-billed advance"
//     affordance; hourly shows rate override; flat shows included/excess.
//   • Activity picker with UTBMS codes (insurance defense matters only).
//   • "Also create entries for…" bulk-expand (same work across 3 co-plaintiffs).
//   • Narrative with AI suggest, attorney-client privilege toggle, and
//     an eth-check: warns if narrative mentions opposing counsel comms
//     without the "privileged" flag, or if entry crosses midnight.
//   • Link to source: email, calendar event, doc, evidence clip.

const ACTIVITY_CODES = [
  { id: 'A101', label: 'Plan and prepare for',           group: 'A · Activities' },
  { id: 'A102', label: 'Research',                       group: 'A · Activities' },
  { id: 'A103', label: 'Draft/revise',                   group: 'A · Activities' },
  { id: 'A104', label: 'Review/analyze',                 group: 'A · Activities' },
  { id: 'A105', label: 'Communicate (in firm)',          group: 'A · Activities' },
  { id: 'A106', label: 'Communicate (with client)',      group: 'A · Activities' },
  { id: 'A107', label: 'Communicate (other counsel)',    group: 'A · Activities' },
  { id: 'A108', label: 'Communicate (other external)',   group: 'A · Activities' },
  { id: 'A109', label: 'Appear for / attend',            group: 'A · Activities' },
  { id: 'A110', label: 'Manage data/files',              group: 'A · Activities' },
  { id: 'A111', label: 'Other',                          group: 'A · Activities' },
];

const TIME_MATTERS = [
  { id: 'alvarez',  name: 'Alvarez v. Aurora PD',     area: '§1983',    fee: 'contingent', rate: null, dot: '#3d83b8', client: 'Maria Alvarez' },
  { id: 'williams', name: 'Williams v. Denver',       area: '§1983',    fee: 'hourly',     rate: 550,  dot: '#3d83b8', client: 'David Williams' },
  { id: 'aurora',   name: 'In re: Aurora class',      area: 'Class',    fee: 'contingent', rate: null, dot: '#8a6a2d', client: '4,200+ class members' },
  { id: 'rivera',   name: 'Rivera v. Lakewood',       area: '§1983',    fee: 'contingent', rate: null, dot: '#3d83b8', client: 'Elena Rivera' },
  { id: 'moreno',   name: 'Moreno v. State',          area: 'CADA',     fee: 'hybrid',     rate: 425,  dot: '#b6623d', client: 'Carmen Moreno' },
  { id: 'patel',    name: 'Patel (intake)',           area: 'FHA',      fee: 'pending',    rate: null, dot: '#2d8a5f', client: 'Angela Patel' },
  { id: 'henson',   name: 'Henson (criminal)',        area: 'Criminal', fee: 'flat',       rate: null, flat: 3500, dot: '#6b4e7d', client: 'Darius Henson' },
  { id: 'nonmatter',name: '— (no matter · firm)',     area: 'Admin',    fee: 'n/a',        rate: null, dot: MF.line,   client: null },
];

const QUICK_ACTIVITIES = [
  { label: 'Client call',                    code: 'A106', guess: 0.5 },
  { label: 'Email correspondence',           code: 'A107', guess: 0.2 },
  { label: 'Review discovery',               code: 'A104', guess: 1.5 },
  { label: 'Draft motion',                   code: 'A103', guess: 2.5 },
  { label: 'Meet & confer',                  code: 'A107', guess: 1.0 },
  { label: 'Court appearance',               code: 'A109', guess: 2.0 },
  { label: 'Deposition prep',                code: 'A101', guess: 2.0 },
  { label: 'Evidence review · BWC',          code: 'A104', guess: 1.0 },
  { label: 'Legal research',                 code: 'A102', guess: 1.5 },
  { label: 'Internal strategy',              code: 'A105', guess: 0.5 },
];

function roundTo(n, step) { return Math.round(n / step) * step; }
function fmtHours(h) { return h.toFixed(1) + 'h'; }
function fmtMoney(n) { return n == null ? '—' : '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

// Shared primitives ───────────────────────────────────────────────────────
function TEField({ label, hint, children, required, grow, error }) {
  return (
    <div className="mf-col" style={{ gap: 4, flex: grow ? 1 : undefined, minWidth: 0 }}>
      <div className="mf-between mf-ai" style={{ minHeight: 16 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: MF.ink2, letterSpacing: '.02em' }}>
          {label} {required && <span style={{ color: '#c13c3c' }}>*</span>}
        </label>
        {hint && <span className="mf-ink4" style={{ fontSize: 10 }}>{hint}</span>}
      </div>
      {children}
      {error && <span style={{ fontSize: 10.5, color: '#c13c3c' }}>{error}</span>}
    </div>
  );
}

function SegBtn({ on, onClick, icon, children, last }) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 12px',
      background: on ? '#fff' : 'transparent',
      color: on ? 'var(--blue-700)' : MF.ink3,
      border: 'none',
      borderRight: last ? 'none' : `1px solid ${MF.line}`,
      boxShadow: on ? 'inset 0 0 0 1px var(--blue-300), 0 1px 2px rgba(0,0,0,.04)' : 'none',
      borderRadius: on ? 5 : 0,
      margin: on ? 2 : 0,
      fontSize: 12, fontWeight: on ? 600 : 500,
      cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontFamily: 'inherit',
    }}>
      {icon && <Icon n={icon} size={12} />}
      {children}
    </button>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────
function TimeEntryModal({ initial, onClose, onSave }) {
  const init = initial || {};
  const [matterId, setMatterId] = React.useState(init.matterId || 'alvarez');
  const [activity, setActivity] = React.useState(init.activity || '');
  const [code, setCode] = React.useState(init.code || 'A103');
  const [narrative, setNarrative] = React.useState(init.narrative || '');
  const [dateStr, setDateStr] = React.useState(init.date || '2026-04-23');
  const [mode, setMode] = React.useState(init.mode || 'hours'); // timer | hours | range
  const [hours, setHours] = React.useState(init.hours ?? 1.0);
  const [startT, setStartT] = React.useState(init.start || '14:00');
  const [endT, setEndT] = React.useState(init.end || '15:30');
  const [timerRunning, setTimerRunning] = React.useState(false);
  const [timerElapsed, setTimerElapsed] = React.useState(0); // seconds
  const [billable, setBillable] = React.useState(init.billable ?? true);
  const [rateOverride, setRateOverride] = React.useState(null);
  const [privileged, setPrivileged] = React.useState(false);
  const [noCharge, setNoCharge] = React.useState(false);
  const [applyTo, setApplyTo] = React.useState([]); // matter ids for multi-apply
  const [showAdv, setShowAdv] = React.useState(false);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [saveFlash, setSaveFlash] = React.useState(false);

  const matter = TIME_MATTERS.find(m => m.id === matterId) || TIME_MATTERS[0];
  const effRate = rateOverride ?? matter.rate ?? 0;
  const isContingent = matter.fee === 'contingent';
  const isFlat = matter.fee === 'flat';
  const isHourly = matter.fee === 'hourly' || matter.fee === 'hybrid';

  // Timer tick
  React.useEffect(() => {
    if (!timerRunning) return;
    const t = setInterval(() => setTimerElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [timerRunning]);

  // Compute hours from mode
  const computedHours = React.useMemo(() => {
    if (mode === 'timer') return roundTo(timerElapsed / 3600, 0.1);
    if (mode === 'range') {
      const [sh, sm] = startT.split(':').map(Number);
      const [eh, em] = endT.split(':').map(Number);
      const mins = (eh * 60 + em) - (sh * 60 + sm);
      return mins > 0 ? roundTo(mins / 60, 0.1) : 0;
    }
    return hours;
  }, [mode, timerElapsed, startT, endT, hours]);

  const amount = billable && !noCharge && isHourly ? Math.round(computedHours * effRate) : 0;

  // Ethics checks
  const warnings = [];
  if (computedHours > 12) warnings.push({ sev: 'warn', msg: 'Entry over 12 hours. Split across days?' });
  if (mode === 'range' && startT > endT) warnings.push({ sev: 'err', msg: 'End time is before start time.' });
  const mentionsOpposing = /opposing|defense counsel|opposing counsel/i.test(narrative);
  if (mentionsOpposing && !privileged) warnings.push({ sev: 'warn', msg: 'Narrative mentions opposing counsel. Consider the privileged flag.' });
  if (billable && !narrative.trim()) warnings.push({ sev: 'warn', msg: 'Billable entry without a narrative will fail the realization review.' });
  if (!matter.rate && isHourly && billable && !rateOverride) warnings.push({ sev: 'warn', msg: 'No default rate on this matter. Set a rate to bill.' });

  // Derived: today's running total on this matter (mock)
  const todayOnMatter = { hours: 2.8, amount: 1540 };
  const monthTotal = { hours: 142.6, billable: 118.2, target: 160 };

  const canSave = computedHours > 0 && matterId && (narrative.trim() || !billable) && !warnings.some(w => w.sev === 'err');

  const save = () => {
    setSaveFlash(true);
    setTimeout(() => { setSaveFlash(false); onSave && onSave(); onClose && onClose(); }, 700);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(12,24,38,.42)',
        zIndex: 150, backdropFilter: 'blur(3px)',
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(880px, 94vw)', maxHeight: '92vh',
        zIndex: 151, background: '#fff', borderRadius: 14,
        boxShadow: '0 30px 80px -20px rgba(12,36,67,.5), 0 12px 36px -12px rgba(0,0,0,.25)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: MF.fUI,
      }}>
        {/* ── Header ── */}
        <div style={{
          padding: '14px 20px 12px',
          background: 'linear-gradient(180deg, #fafbfd, #f5f7fb)',
          borderBottom: `1px solid ${MF.line}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: 'linear-gradient(135deg, var(--blue-500), var(--blue-700))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', boxShadow: '0 2px 6px -1px rgba(37,99,168,.5)',
          }}><Icon n="clock" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f1b2e', letterSpacing: '-.01em' }}>
              {init.matterId ? 'Log time' : 'New time entry'}
            </div>
            <div className="mf-ink3" style={{ fontSize: 11.5 }}>
              {matter.name} · <span style={{ color: matter.dot, fontWeight: 600 }}>{matter.area}</span> · {matter.fee}
              {init.source && <> · from {init.source}</>}
            </div>
          </div>
          <div className="mf-row mf-g6 mf-ai">
            <span className="mf-mono mf-ink4" style={{ fontSize: 10 }}>⌘ Enter to save</span>
            <button onClick={onClose} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 6, color: MF.ink3, borderRadius: 6,
            }} onMouseEnter={e => e.currentTarget.style.background = MF.bg2}
               onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <Icon n="close" size={14} />
            </button>
          </div>
        </div>

        {/* ── Body (scrollable) ── */}
        <div className="mf-scroll" style={{ overflowY: 'auto', flex: 1, padding: '16px 20px' }}>
          {/* Source banner if coming from email/event */}
          {init.source && (
            <div style={{
              padding: '8px 12px', marginBottom: 14,
              background: 'var(--blue-tint)', border: '1px solid var(--blue-200)',
              borderRadius: 8, fontSize: 11.5, color: 'var(--blue-900)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Icon n="link" size={12} style={{ color: 'var(--blue-500)' }} />
              <span>
                <b>Auto-drafted</b> from {init.source}.
                {init.sourceHint && <span className="mf-ink3" style={{ marginLeft: 6 }}>{init.sourceHint}</span>}
              </span>
            </div>
          )}

          {/* Row 1: Matter + Date */}
          <div className="mf-row mf-g12" style={{ marginBottom: 14 }}>
            <TEField label="Matter" required grow hint={matter.client || ''}>
              <MatterPicker value={matterId} onChange={setMatterId} />
            </TEField>
            <TEField label="Date" required>
              <div className="mf-row mf-g4 mf-ai">
                <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
                       style={fieldStyle(120)} />
                <button onClick={() => setDateStr('2026-04-23')} style={pillBtn}>Today</button>
                <button onClick={() => setDateStr('2026-04-22')} style={pillBtn}>Yest.</button>
              </div>
            </TEField>
          </div>

          {/* Row 2: Duration mode + value — signature UX */}
          <div style={{
            background: '#fbfafa', border: `1px solid ${MF.line}`, borderRadius: 10,
            padding: 14, marginBottom: 14,
          }}>
            <div className="mf-between mf-ai" style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: MF.ink2 }}>Duration</label>
              <div style={{
                display: 'inline-flex', alignItems: 'center',
                background: '#fff', border: `1px solid ${MF.line}`,
                borderRadius: 7, padding: 0, overflow: 'hidden',
              }}>
                <SegBtn on={mode === 'timer'} onClick={() => setMode('timer')} icon="clock">Timer</SegBtn>
                <SegBtn on={mode === 'hours'} onClick={() => setMode('hours')} icon="hash">Hours</SegBtn>
                <SegBtn on={mode === 'range'} onClick={() => setMode('range')} icon="cal" last>Start → end</SegBtn>
              </div>
            </div>

            {mode === 'timer' && (
              <div className="mf-row mf-g12 mf-ai">
                <div style={{
                  fontFamily: MF.fMono, fontSize: 42, fontWeight: 500, color: '#0f1b2e',
                  letterSpacing: '-.02em', minWidth: 150,
                }}>
                  {String(Math.floor(timerElapsed / 3600)).padStart(2, '0')}:
                  {String(Math.floor((timerElapsed % 3600) / 60)).padStart(2, '0')}:
                  {String(timerElapsed % 60).padStart(2, '0')}
                </div>
                <div className="mf-col mf-g6">
                  {!timerRunning ? (
                    <button onClick={() => setTimerRunning(true)} style={{
                      padding: '8px 16px', background: 'var(--blue-500)', color: '#fff',
                      border: 'none', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}><Icon n="clock" size={13} />Start timer</button>
                  ) : (
                    <button onClick={() => setTimerRunning(false)} style={{
                      padding: '8px 16px', background: '#c13c3c', color: '#fff',
                      border: 'none', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                    }}>Pause</button>
                  )}
                  <div className="mf-row mf-g4">
                    <button onClick={() => setTimerElapsed(0)} style={pillBtn}>Reset</button>
                    <button onClick={() => { setMode('hours'); setHours(roundTo(timerElapsed / 3600, 0.1) || 0.1); }} style={pillBtn}>Convert to hours</button>
                  </div>
                </div>
                <div className="mf-col" style={{ flex: 1, textAlign: 'right' }}>
                  <div className="mf-ink4" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>Rounded</div>
                  <div className="mf-mono" style={{ fontSize: 22, fontWeight: 600, color: 'var(--blue-700)' }}>{fmtHours(computedHours)}</div>
                  <div className="mf-ink4" style={{ fontSize: 10 }}>to nearest 0.1</div>
                </div>
              </div>
            )}

            {mode === 'hours' && (
              <div className="mf-row mf-g12 mf-ai">
                <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                  <button onClick={() => setHours(Math.max(0, roundTo(hours - 0.1, 0.1)))} style={stepBtn('l')}>−</button>
                  <input type="number" step="0.1" min="0" max="24" value={hours}
                         onChange={e => setHours(Math.max(0, parseFloat(e.target.value) || 0))}
                         style={{
                           width: 90, height: 40, textAlign: 'center',
                           fontFamily: MF.fMono, fontSize: 22, fontWeight: 600, color: '#0f1b2e',
                           border: `1px solid ${MF.line}`, borderLeft: 'none', borderRight: 'none',
                           outline: 'none', background: '#fff',
                         }} />
                  <button onClick={() => setHours(roundTo(hours + 0.1, 0.1))} style={stepBtn('r')}>+</button>
                  <span style={{ marginLeft: 10, fontSize: 14, fontWeight: 500, color: MF.ink2 }}>hours</span>
                </div>
                <div className="mf-row mf-g4" style={{ flexWrap: 'wrap' }}>
                  {[0.1, 0.2, 0.3, 0.5, 1, 1.5, 2, 3].map(h => (
                    <button key={h} onClick={() => setHours(h)}
                            style={{
                              ...pillBtn,
                              background: hours === h ? 'var(--blue-500)' : '#fff',
                              color: hours === h ? '#fff' : MF.ink2,
                              borderColor: hours === h ? 'var(--blue-500)' : MF.line,
                              fontFamily: MF.fMono,
                            }}>
                      {h}
                    </button>
                  ))}
                </div>
                <div className="mf-col" style={{ flex: 1, textAlign: 'right' }}>
                  <div className="mf-ink4" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>Billable amount</div>
                  <div className="mf-mono" style={{ fontSize: 22, fontWeight: 600, color: billable && !noCharge ? 'var(--blue-700)' : MF.ink4 }}>
                    {isHourly ? fmtMoney(amount) : isContingent ? 'Contingent' : isFlat ? 'Flat fee' : '—'}
                  </div>
                  <div className="mf-ink4" style={{ fontSize: 10 }}>
                    {isHourly && effRate ? `${fmtHours(computedHours)} × ${fmtMoney(effRate)}/hr` : isContingent ? 'Time tracked, no invoice' : ''}
                  </div>
                </div>
              </div>
            )}

            {mode === 'range' && (
              <div className="mf-row mf-g12 mf-ai">
                <TEField label="Start">
                  <input type="time" value={startT} onChange={e => setStartT(e.target.value)} style={fieldStyle(100)} />
                </TEField>
                <span style={{ marginTop: 18, color: MF.ink3 }}>→</span>
                <TEField label="End">
                  <input type="time" value={endT} onChange={e => setEndT(e.target.value)} style={fieldStyle(100)} />
                </TEField>
                <div className="mf-col" style={{ flex: 1, textAlign: 'right', marginTop: 18 }}>
                  <div className="mf-ink4" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>Duration</div>
                  <div className="mf-mono" style={{ fontSize: 22, fontWeight: 600, color: 'var(--blue-700)' }}>{fmtHours(computedHours)}</div>
                  <div className="mf-ink4" style={{ fontSize: 10 }}>rounded to 0.1</div>
                </div>
              </div>
            )}
          </div>

          {/* Row 3: Activity + code */}
          <div className="mf-row mf-g12" style={{ marginBottom: 14 }}>
            <TEField label="Activity" required grow>
              <input type="text" value={activity} onChange={e => setActivity(e.target.value)}
                     placeholder="Short label — e.g. Draft motion to compel"
                     style={fieldStyle()} />
              {!activity && (
                <div className="mf-row mf-g4 mf-ai" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                  <span className="mf-ink4" style={{ fontSize: 10 }}>Quick:</span>
                  {QUICK_ACTIVITIES.slice(0, 6).map(q => (
                    <button key={q.label} onClick={() => { setActivity(q.label); setCode(q.code); if (mode === 'hours') setHours(q.guess); }}
                            style={{ ...pillBtn, fontSize: 10.5 }}>{q.label}</button>
                  ))}
                </div>
              )}
            </TEField>
            <TEField label="UTBMS code" hint="for insurance defense">
              <select value={code} onChange={e => setCode(e.target.value)} style={{ ...fieldStyle(170), cursor: 'pointer' }}>
                {ACTIVITY_CODES.map(c => (
                  <option key={c.id} value={c.id}>{c.id} · {c.label}</option>
                ))}
              </select>
            </TEField>
          </div>

          {/* Row 4: Narrative */}
          <TEField label="Narrative" hint={`${narrative.length} chars · client-facing`}>
            <div style={{
              border: `1px solid ${MF.line}`, borderRadius: 7, background: '#fff',
              overflow: 'hidden',
            }}>
              <textarea
                value={narrative}
                onChange={e => setNarrative(e.target.value)}
                placeholder="Describe work performed. Be specific — this will appear on the client's invoice verbatim."
                rows={4}
                style={{
                  width: '100%', border: 'none', outline: 'none',
                  padding: '10px 12px', fontSize: 12.5,
                  fontFamily: MF.fUI, color: MF.ink, resize: 'vertical',
                  lineHeight: 1.55, background: 'transparent',
                }} />
              <div className="mf-between mf-ai" style={{
                padding: '6px 10px',
                background: '#fbfafa', borderTop: `1px solid ${MF.line}`,
              }}>
                <div className="mf-row mf-g4 mf-ai">
                  <button onClick={() => setAiOpen(!aiOpen)} style={{
                    ...pillBtn,
                    background: aiOpen ? 'var(--blue-500)' : '#fff',
                    color: aiOpen ? '#fff' : 'var(--blue-700)',
                    borderColor: aiOpen ? 'var(--blue-500)' : 'var(--blue-300)',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}><Icon n="sparkle" size={11} />Suggest from source</button>
                  <button style={pillBtn}>Template ▾</button>
                  <button style={pillBtn}>Apply firm style</button>
                </div>
                <span className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>
                  Readability: {narrative.length > 40 ? 'good' : narrative.length > 10 ? 'thin' : '—'}
                </span>
              </div>
              {aiOpen && (
                <div style={{
                  padding: 12, background: 'var(--blue-tint)', borderTop: `1px solid var(--blue-200)`,
                }}>
                  <div className="mf-ink3" style={{ fontSize: 10.5, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    Suggested from email thread · RE: CGIA Notice of Claim
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: MF.ink, background: '#fff', padding: 10, borderRadius: 6, border: `1px solid var(--blue-200)` }}>
                    Reviewed CGIA Notice of Claim receipt from City of Aurora (claim no. 26-AUR-00481); analyzed 90-day statutory response period and scoped BWC production request for Officer Holden; drafted reply confirming retention window and identifying CAD log and use-of-force training record requests.
                  </div>
                  <div className="mf-row mf-g4" style={{ marginTop: 8 }}>
                    <button onClick={() => { setNarrative('Reviewed CGIA Notice of Claim receipt from City of Aurora (claim no. 26-AUR-00481); analyzed 90-day statutory response period and scoped BWC production request for Officer Holden; drafted reply confirming retention window and identifying CAD log and use-of-force training record requests.'); setAiOpen(false); }}
                            style={{ ...pillBtn, background: 'var(--blue-500)', color: '#fff', borderColor: 'var(--blue-500)' }}>Use this</button>
                    <button style={pillBtn}>Regenerate</button>
                    <button onClick={() => setAiOpen(false)} style={pillBtn}>Dismiss</button>
                  </div>
                </div>
              )}
            </div>
          </TEField>

          {/* Billing row */}
          <div style={{
            marginTop: 14, padding: 12,
            background: '#fbfafa', border: `1px solid ${MF.line}`, borderRadius: 10,
          }}>
            <div className="mf-between mf-ai" style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: MF.ink2, textTransform: 'uppercase', letterSpacing: '.06em' }}>Billing</div>
              <div className="mf-row mf-g4 mf-ai">
                <FeeBadge fee={matter.fee} />
                {matter.rate && <Chip accent style={{ fontSize: 10 }}>{fmtMoney(matter.rate)}/hr default</Chip>}
                {matter.flat && <Chip accent style={{ fontSize: 10 }}>{fmtMoney(matter.flat)} flat</Chip>}
              </div>
            </div>

            <div className="mf-row mf-g16 mf-ai" style={{ flexWrap: 'wrap' }}>
              <Toggle label="Billable" on={billable} onChange={setBillable} />
              <Toggle label="No-charge (write-off)" on={noCharge} onChange={setNoCharge} disabled={!billable} />
              <Toggle label="Privileged" on={privileged} onChange={setPrivileged} />
              {isHourly && (
                <TEField label="Rate override" hint="leave blank for default">
                  <div className="mf-row mf-g4 mf-ai">
                    <span className="mf-mono" style={{ fontSize: 13 }}>$</span>
                    <input type="number" value={rateOverride ?? ''} placeholder={String(matter.rate || 0)}
                           onChange={e => setRateOverride(e.target.value ? parseFloat(e.target.value) : null)}
                           style={fieldStyle(80)} />
                    <span className="mf-ink4" style={{ fontSize: 11 }}>/hr</span>
                  </div>
                </TEField>
              )}
              {isContingent && (
                <div className="mf-ink3" style={{ fontSize: 11, fontStyle: 'italic' }}>
                  Contingent fee matter — hours tracked for effort analysis only.
                </div>
              )}
              {isFlat && (
                <div className="mf-ink3" style={{ fontSize: 11 }}>
                  Flat fee matter: {fmtMoney(matter.flat)}. 12.4h logged so far — {((12.4 + computedHours) * 250 / matter.flat * 100).toFixed(0)}% effective rate erosion.
                </div>
              )}
            </div>
          </div>

          {/* Advanced toggle */}
          <button onClick={() => setShowAdv(!showAdv)} style={{
            marginTop: 12, padding: '6px 0', background: 'transparent', border: 'none',
            color: 'var(--blue-700)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            {showAdv ? '▾' : '▸'} Advanced · links, multi-matter, expenses
          </button>

          {showAdv && (
            <div style={{
              marginTop: 8, padding: 12,
              background: '#fbfafa', border: `1px solid ${MF.line}`, borderRadius: 10,
            }}>
              <TEField label="Also apply this entry to" hint="splits hours across selected matters">
                <div className="mf-row mf-g4" style={{ flexWrap: 'wrap' }}>
                  {TIME_MATTERS.filter(m => m.id !== matterId && m.id !== 'nonmatter').map(m => {
                    const on = applyTo.includes(m.id);
                    return (
                      <button key={m.id} onClick={() => setApplyTo(a => on ? a.filter(x => x !== m.id) : [...a, m.id])}
                              style={{
                                ...pillBtn,
                                background: on ? 'var(--blue-500)' : '#fff',
                                color: on ? '#fff' : MF.ink2,
                                borderColor: on ? 'var(--blue-500)' : MF.line,
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                              }}>
                        <span style={{ width: 6, height: 6, borderRadius: 3, background: m.dot }} />
                        {m.name}
                      </button>
                    );
                  })}
                </div>
                {applyTo.length > 0 && (
                  <div className="mf-ink3" style={{ fontSize: 11, marginTop: 6 }}>
                    Will create {applyTo.length + 1} entries of {fmtHours(computedHours / (applyTo.length + 1))} each.
                  </div>
                )}
              </TEField>
              <div className="mf-hbar" style={{ margin: '12px 0' }} />
              <div className="mf-row mf-g12">
                <TEField label="Link to">
                  <div className="mf-row mf-g4" style={{ flexWrap: 'wrap' }}>
                    <button style={{ ...pillBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon n="mail" size={11} />Email thread</button>
                    <button style={{ ...pillBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon n="cal" size={11} />Calendar event</button>
                    <button style={{ ...pillBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon n="doc" size={11} />Document</button>
                    <button style={{ ...pillBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon n="video" size={11} />Evidence clip</button>
                  </div>
                </TEField>
                <TEField label="Expense with this entry?">
                  <button style={{ ...pillBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon n="plus" size={11} />Add expense</button>
                </TEField>
              </div>
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div style={{
              marginTop: 14, padding: '10px 12px',
              background: warnings.some(w => w.sev === 'err') ? '#fdf0ee' : '#fdf6e9',
              border: `1px solid ${warnings.some(w => w.sev === 'err') ? '#e2c0ad' : '#e8d488'}`,
              borderRadius: 8,
            }}>
              {warnings.map((w, i) => (
                <div key={i} className="mf-row mf-g6 mf-ai" style={{
                  fontSize: 11.5, color: w.sev === 'err' ? '#8a3a2a' : '#6a5020',
                  marginBottom: i < warnings.length - 1 ? 4 : 0,
                }}>
                  <Icon n="warn" size={12} style={{ color: w.sev === 'err' ? '#c13c3c' : '#b88a2d' }} />
                  <span>{w.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: '12px 20px',
          background: '#fbfafa', borderTop: `1px solid ${MF.line}`,
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <div className="mf-col" style={{ flex: 1 }}>
            <div className="mf-row mf-g10 mf-ai">
              <span className="mf-ink4 mf-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>Today on {matter.name.split(' ')[0]}</span>
              <span className="mf-mono" style={{ fontSize: 12, fontWeight: 600 }}>
                {fmtHours(todayOnMatter.hours + (mode !== 'timer' ? computedHours : 0))}
                <span className="mf-ink4" style={{ fontWeight: 400, marginLeft: 4 }}>· {fmtMoney(todayOnMatter.amount + amount)}</span>
              </span>
              <span className="mf-ink4" style={{ fontSize: 10 }}>|</span>
              <span className="mf-ink4 mf-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>April</span>
              <span className="mf-mono" style={{ fontSize: 12, fontWeight: 600 }}>
                {fmtHours(monthTotal.billable)}<span className="mf-ink4" style={{ fontWeight: 400 }}> / {monthTotal.target}h</span>
              </span>
              <div style={{ width: 80, height: 4, background: MF.line, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${monthTotal.billable / monthTotal.target * 100}%`, height: '100%', background: 'var(--blue-500)' }} />
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            padding: '8px 14px', background: '#fff', color: MF.ink2,
            border: `1px solid ${MF.line}`, borderRadius: 7,
            fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>Cancel</button>
          <button onClick={save} style={{
            padding: '8px 14px', background: '#fff', color: 'var(--blue-700)',
            border: `1px solid var(--blue-300)`, borderRadius: 7,
            fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>Save & new</button>
          <button onClick={save} disabled={!canSave} style={{
            padding: '8px 18px',
            background: canSave ? 'linear-gradient(180deg, var(--blue-500), var(--blue-600))' : MF.ink4,
            color: '#fff', border: 'none', borderRadius: 7,
            fontSize: 12.5, fontWeight: 600,
            cursor: canSave ? 'pointer' : 'not-allowed',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            boxShadow: canSave ? '0 2px 6px -1px rgba(37,99,168,.5)' : 'none',
            fontFamily: 'inherit',
            transition: 'all .15s',
          }}>
            {saveFlash ? <>✓ Saved</> : <><Icon n="check" size={12} />Save entry</>}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────
function fieldStyle(w) {
  return {
    width: w || '100%', height: 34,
    padding: '0 10px',
    border: `1px solid ${MF.line}`, borderRadius: 7,
    background: '#fff', outline: 'none',
    fontSize: 12.5, fontFamily: 'inherit', color: MF.ink,
    boxSizing: 'border-box',
  };
}
const pillBtn = {
  padding: '4px 10px', fontSize: 11,
  background: '#fff', color: MF.ink2,
  border: `1px solid ${MF.line}`, borderRadius: 999,
  cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
};
function stepBtn(side) {
  return {
    width: 34, height: 40,
    background: '#fff', border: `1px solid ${MF.line}`,
    borderRadius: side === 'l' ? '7px 0 0 7px' : '0 7px 7px 0',
    fontSize: 18, color: MF.ink2, cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

function Toggle({ label, on, onChange, disabled }) {
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1, userSelect: 'none',
    }}>
      <span onClick={() => !disabled && onChange(!on)} style={{
        width: 30, height: 17, background: on ? 'var(--blue-500)' : MF.line,
        borderRadius: 10, position: 'relative', transition: 'background .15s',
        flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 15 : 2,
          width: 13, height: 13, background: '#fff', borderRadius: 7,
          transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)',
        }} />
      </span>
      <span style={{ fontSize: 12, fontWeight: 500, color: MF.ink2 }}>{label}</span>
    </label>
  );
}

function FeeBadge({ fee }) {
  const map = {
    contingent: { label: 'Contingent',        bg: '#fdf4d5', fg: '#8a6a2d' },
    hourly:     { label: 'Hourly',            bg: 'var(--blue-100)', fg: 'var(--blue-900)' },
    hybrid:     { label: 'Hybrid',            bg: '#eef0f9', fg: '#3a3e85' },
    flat:       { label: 'Flat fee',          bg: '#f0e8f0', fg: '#6b4e7d' },
    pending:    { label: 'Pre-engagement',    bg: '#ecf6f1', fg: '#2d8a5f' },
    'n/a':      { label: 'Non-matter',        bg: MF.bg2,    fg: MF.ink3 },
  };
  const m = map[fee] || map['n/a'];
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 4,
      background: m.bg, color: m.fg,
      fontSize: 10, fontWeight: 600, fontFamily: MF.fMono,
      textTransform: 'uppercase', letterSpacing: '.04em',
    }}>{m.label}</span>
  );
}

// ── Matter picker (combobox-style) ────────────────────────────────────────
function MatterPicker({ value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const ref = React.useRef(null);
  const current = TIME_MATTERS.find(m => m.id === value) || TIME_MATTERS[0];

  React.useEffect(() => {
    const onOut = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  const filtered = q
    ? TIME_MATTERS.filter(m => (m.name + m.area + (m.client || '')).toLowerCase().includes(q.toLowerCase()))
    : TIME_MATTERS;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        ...fieldStyle(), display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
        textAlign: 'left', height: 34,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: current.dot, flexShrink: 0 }} />
        <span style={{ fontWeight: 500, color: MF.ink }}>{current.name}</span>
        <span className="mf-ink3" style={{ fontSize: 11 }}>· {current.area}</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: MF.ink3 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 38, left: 0, right: 0, zIndex: 200,
          background: '#fff', border: `1px solid ${MF.line}`, borderRadius: 8,
          boxShadow: '0 8px 24px -6px rgba(0,0,0,.15), 0 2px 6px -2px rgba(0,0,0,.08)',
          overflow: 'hidden',
        }}>
          <div style={{ padding: 8, borderBottom: `1px solid ${MF.line}`, background: '#fbfafa' }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
                   placeholder="Search matters, clients, areas…"
                   style={{ ...fieldStyle(), height: 28, fontSize: 12 }} />
          </div>
          <div className="mf-scroll" style={{ maxHeight: 280, overflowY: 'auto' }}>
            {filtered.map(m => (
              <div key={m.id} onClick={() => { onChange(m.id); setOpen(false); setQ(''); }}
                   style={{
                     padding: '8px 12px', cursor: 'pointer',
                     display: 'flex', alignItems: 'center', gap: 8,
                     background: m.id === value ? 'var(--blue-soft)' : 'transparent',
                     borderLeft: m.id === value ? '3px solid var(--blue-500)' : '3px solid transparent',
                   }}
                   onMouseEnter={e => { if (m.id !== value) e.currentTarget.style.background = MF.bg2; }}
                   onMouseLeave={e => { if (m.id !== value) e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: m.dot, flexShrink: 0 }} />
                <div className="mf-col" style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{m.name}</div>
                  <div className="mf-ink3" style={{ fontSize: 10.5 }}>
                    {m.area} · {m.fee} · {m.client || '—'}
                  </div>
                </div>
                <FeeBadge fee={m.fee} />
              </div>
            ))}
          </div>
          <div className="mf-between mf-ai" style={{ padding: '6px 10px', borderTop: `1px solid ${MF.line}`, background: '#fbfafa' }}>
            <span className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>↑↓ to nav · ↵ select</span>
            <button style={{ ...pillBtn, fontSize: 10.5 }}>+ New matter</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Demo page — showcases the modal with quick-launch cards ───────────────
function PageTimeEntryDemo({ go }) {
  const [open, setOpen] = React.useState(null); // null | {preset}

  const presets = [
    { title: 'Blank entry', sub: 'Log from scratch · all fields empty', icon: 'plus', preset: {} },
    { title: 'From email thread',
      sub: 'RE: CGIA Notice of Claim · Alvarez',
      icon: 'mail',
      preset: { matterId: 'alvarez', activity: 'Email — opposing counsel', code: 'A107',
                source: 'email thread (Apr 23, 9:42a)', sourceHint: 'Narrative drafted from thread.',
                hours: 0.3, mode: 'hours', narrative: '' } },
    { title: 'From calendar event',
      sub: 'Deposition prep · Officer Doe · 1:00p-3:00p',
      icon: 'cal',
      preset: { matterId: 'alvarez', activity: 'Deposition prep · Officer Doe', code: 'A101',
                source: 'calendar event · Apr 22', mode: 'range', start: '13:00', end: '15:00' } },
    { title: 'Stopped timer',
      sub: '47 min on Williams matter — log now?',
      icon: 'clock',
      preset: { matterId: 'williams', activity: 'Meet & confer prep', code: 'A101',
                source: 'paused timer', mode: 'hours', hours: 0.8 } },
    { title: 'From document',
      sub: 'Motion to compel · 4.2h auto-tracked',
      icon: 'doc',
      preset: { matterId: 'alvarez', activity: 'Motion to compel · draft', code: 'A103',
                source: 'document (MS Word plugin)', mode: 'hours', hours: 4.2,
                narrative: 'Drafted motion to compel BWC production for all four responding officers; researched scope arguments under Rule 26(b) proportionality framework; incorporated client declarations.' } },
    { title: 'Flat-fee matter',
      sub: 'Henson criminal · track against $3,500 budget',
      icon: 'dollar',
      preset: { matterId: 'henson', activity: 'Plea negotiation', code: 'A107',
                mode: 'hours', hours: 1.2 } },
  ];

  return (
    <AppShell path="time" go={go} topbar={
      <AppTopBar crumbs="TIME" title="Log time" sub={<span className="mf-ink3">Start a new entry · auto-drafted from recent activity</span>}
        right={<><GlobalSearch /><Btn primary icon="plus" onClick={() => setOpen({ preset: {} })}>New entry</Btn></>} />
    }>
      <div className="mf-scroll" style={{ overflowY: 'auto', flex: 1 }}>
        <div className="mf-p16 mf-col mf-g16" style={{ padding: 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}>

          <div className="mf-col mf-g4">
            <div className="mf-ink4" style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase' }}>Quick-start</div>
            <div className="mf-disp" style={{ fontSize: 26, color: '#0f1b2e' }}>Six untracked work sessions need logging.</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {presets.map(p => (
              <div key={p.title} onClick={() => setOpen(p)}
                   className="app-card-hover"
                   style={{
                     background: '#fff', border: `1px solid ${MF.line}`, borderRadius: 10,
                     padding: 14, cursor: 'pointer', transition: 'all .15s',
                   }}>
                <div className="mf-row mf-g8 mf-ai" style={{ marginBottom: 8 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: 'var(--blue-tint)', color: 'var(--blue-700)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}><Icon n={p.icon} size={15} /></div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.title}</div>
                </div>
                <div className="mf-ink3" style={{ fontSize: 11.5, lineHeight: 1.4 }}>{p.sub}</div>
              </div>
            ))}
          </div>

          <div className="mf-hbar" style={{ margin: '8px 0' }} />

          {/* Recent entries mini-table for context */}
          <div className="mf-col mf-g4">
            <div className="mf-ink4" style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase' }}>This week</div>
            <div className="mf-disp" style={{ fontSize: 20, color: '#0f1b2e' }}>21.4h logged · 18.2h billable · $10,010 WIP</div>
          </div>

          <div className="mf-card">
            <table className="mf-table">
              <thead><tr><th>Date</th><th>Matter</th><th>Activity</th><th>Hours</th><th>Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {[
                  ['Apr 22', 'Alvarez',  'Motion to compel · draft & file',   '3.4', '$1,870', 'billable'],
                  ['Apr 22', 'Williams', 'Meet & confer prep',                '1.2', '$660',   'billable'],
                  ['Apr 21', 'Aurora',   'Class cert · brief writing',        '5.6', 'contingent', 'tracked'],
                  ['Apr 21', '—',        'Firm admin · hiring',               '1.0', '—',      'non-bill'],
                  ['Apr 20', 'Alvarez',  'Evidence review · BWC',             '2.8', 'contingent', 'tracked'],
                  ['Apr 19', 'Moreno',   'Client call + follow-up',           '0.8', '$340',   'billable'],
                ].map((r, i) => (
                  <tr key={i} onClick={() => setOpen({ preset: { matterId: r[1].toLowerCase(), activity: r[2], hours: parseFloat(r[3]) } })}
                      style={{ cursor: 'pointer' }}>
                    <td className="mf-mono" style={{ fontSize: 11 }}>{r[0]}</td>
                    <td>{r[1]}</td>
                    <td>{r[2]}</td>
                    <td className="mf-mono" style={{ textAlign: 'right' }}>{r[3]}</td>
                    <td className="mf-mono" style={{ fontWeight: 600 }}>{r[4]}</td>
                    <td>{r[5] === 'billable' ? <Chip ok>bill</Chip> : r[5] === 'tracked' ? <Chip accent>tracked</Chip> : <Chip ghost>n/b</Chip>}</td>
                    <td><span className="mf-link" style={{ fontSize: 11 }}>Edit →</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      </div>

      {open && <TimeEntryModal initial={open.preset} onClose={() => setOpen(null)} />}
    </AppShell>
  );
}

Object.assign(window, { TimeEntryModal, PageTimeEntryDemo, TIME_MATTERS, fmtHours, fmtMoney, roundTo });
