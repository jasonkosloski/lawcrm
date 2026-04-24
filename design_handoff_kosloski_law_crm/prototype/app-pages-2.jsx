// Final prototype — Intake, Calendar, Settlement, Billing, Time, Reports, Automations, Settings

// ── INTAKE ──────────────────────────────────────────────────────────────────
function PageIntake({ go }) {
  const leads = [
    { n: 'Perez, Luis',       src: 'web · §1983', dt: 'today 8:42a',  score: 92, conflict: 'clear',  stage: 'new',        sum: 'Client alleges traffic stop in Aurora; officer used knee strike, concussion diagnosed at UCH.' },
    { n: 'Okafor, Adaeze',    src: 'ref · Fox',   dt: 'today 8:11a',  score: 88, conflict: 'clear',  stage: 'contacted',  sum: 'Wrongful termination after reporting FMLA violation. EEOC filed; 90d clock started 4/18.' },
    { n: 'Thompson, Garret',  src: 'web · FHA',   dt: 'yest.',        score: 74, conflict: 'clear',  stage: 'new',        sum: 'Denied housing application; says disparate-impact based on source of income (voucher).' },
    { n: 'Lin, Kai',          src: 'referral',    dt: 'yest.',        score: 80, conflict: 'WARN',   stage: 'hold',       sum: 'Potential positional conflict — firm represents a co-defendant in a similar pattern case.' },
    { n: 'Ndiaye, Fatou',     src: 'phone',       dt: '2d',           score: 65, conflict: 'clear',  stage: 'qualifying', sum: 'Education · IDEA. Student with IEP; district cut services mid-year.' },
    { n: 'Brown, Arnold',     src: 'web · crim.', dt: '2d',           score: 41, conflict: 'clear',  stage: 'decline',    sum: 'DUI #2; out of practice scope (flat-fee criminal only for related civil matters).' },
    { n: 'Cisneros, Ramón',   src: 'web · §1983', dt: '3d',           score: 71, conflict: 'clear',  stage: 'meeting',    sum: 'Arrest in Denver; alleges retaliatory search after filming. Meeting Thu.' },
  ];
  const [sel, setSel] = React.useState(leads[0]);
  return (
    <AppShell path="intake" go={go} topbar={
      <AppTopBar
        crumbs="INTAKE QUEUE"
        title="Triage"
        sub={<span className="mf-ink3">23 open · 4 new today · 1 conflict warning</span>}
        right={<>
          <GlobalSearch />
          <Btn icon="bolt">Run automation</Btn>
          <Btn primary icon="plus">New lead</Btn>
        </>}
      />
    }>
      <div className="mf-row mf-flex1" style={{ overflow: 'hidden', minHeight: 0 }}>
        {/* list */}
        <div className="mf-col" style={{ width: 360, borderRight: `1px solid ${MF.line}`, background: MF.card }}>
          <div className="mf-between mf-p10 mf-hl">
            <Seg options={['All', 'New', 'Conflicts', 'Mine']} value="All" />
            <Btn sm icon="filter">Sort</Btn>
          </div>
          <div className="mf-col mf-scroll" style={{ overflowY: 'auto', flex: 1 }}>
            {leads.map((l, i) => (
              <div key={i} className="mf-col mf-p10" onClick={() => setSel(l)}
                   style={{ borderBottom: `1px solid ${MF.line}`, cursor: 'pointer', background: sel === l ? MF.accentSoft : 'transparent', gap: 4 }}>
                <div className="mf-between">
                  <div className="mf-row mf-g8 mf-ai">
                    <Av initials={l.n.split(',')[0].slice(0, 2).toUpperCase()} />
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{l.n}</span>
                  </div>
                  <div className="mf-row mf-g4 mf-ai">
                    <span className="mf-mono" style={{ fontSize: 10.5, fontWeight: 600, color: l.score > 75 ? MF.ok : l.score > 55 ? MF.ink : MF.ink4 }}>{l.score}</span>
                  </div>
                </div>
                <div className="mf-ink3" style={{ fontSize: 11, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{l.sum}</div>
                <div className="mf-row mf-g6 mf-ai">
                  <Chip style={{ fontSize: 10 }}>{l.src}</Chip>
                  <span className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>{l.dt}</span>
                  {l.conflict === 'WARN' && <Chip warn style={{ fontSize: 10 }}>conflict</Chip>}
                  {l.stage === 'new'        && <Chip hi    style={{ fontSize: 10 }}>new</Chip>}
                  {l.stage === 'meeting'    && <Chip accent style={{ fontSize: 10 }}>meeting</Chip>}
                  {l.stage === 'decline'    && <Chip ghost style={{ fontSize: 10 }}>decline</Chip>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* detail */}
        <div className="mf-col mf-flex1" style={{ background: MF.bg, overflow: 'auto' }}>
          <div className="mf-p16 mf-col mf-g12" style={{ padding: 20, maxWidth: 820 }}>
            <div className="mf-between">
              <div className="mf-col" style={{ gap: 2 }}>
                <div className="mf-mono mf-ink4" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>LEAD · {sel.src}</div>
                <div className="app-h1" style={{ fontSize: 22 }}>{sel.n}</div>
                <div className="mf-ink3" style={{ fontSize: 12 }}>Received {sel.dt} · via intake form</div>
              </div>
              <div className="mf-row mf-g6">
                <Btn ghost>Decline</Btn>
                <Btn icon="cal">Schedule consult</Btn>
                <Btn primary icon="check">Convert to matter</Btn>
              </div>
            </div>

            {sel.conflict === 'WARN' && (
              <div className="mf-card mf-p12" style={{ background: '#fdf4ec', borderColor: '#e9caa7' }}>
                <div className="mf-row mf-g8 mf-ai"><Icon n="warn" size={14} style={{ color: MF.warn }} /><strong style={{ fontSize: 12.5 }}>Conflict check · potential issue</strong></div>
                <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.55 }}>
                  Name match on <em>opposing</em> in <strong>Boaz v. Aurora PD</strong> (open). Positional conflict likely — same APD pattern evidence.
                  Requires partner review before accepting.
                </div>
                <div className="mf-row mf-g6" style={{ marginTop: 10 }}><Btn sm ghost>View match</Btn><Btn sm>Override w/ memo</Btn><Btn sm primary>Decline & note</Btn></div>
              </div>
            )}

            <div className="mf-row mf-g12">
              <div className="mf-card mf-flex1 mf-p14">
                <div className="mf-sec">Summary · auto-extracted</div>
                <div style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.55 }}>{sel.sum}</div>
                <hr className="mf-rule" style={{ margin: '12px 0' }} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
                  {[
                    ['Location', 'Aurora, CO'], ['Date of incident', '2026-03-12'], ['Injury', 'Concussion, shoulder'],
                    ['Police report', 'not yet obtained'], ['Prior counsel', 'none'], ['Statute window', '~164 days'],
                  ].map(([k, v]) => (
                    <div key={k} className="mf-col" style={{ gap: 0 }}>
                      <div className="mf-ink4" style={{ fontSize: 10, textTransform: 'uppercase' }}>{k}</div>
                      <div style={{ fontSize: 12 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mf-card mf-p12" style={{ width: 280 }}>
                <div className="mf-sec">Lead score</div>
                <div className="mf-row mf-g10 mf-ai" style={{ marginTop: 10 }}>
                  <svg width="56" height="56" viewBox="0 0 56 56" className="app-ring">
                    <circle cx="28" cy="28" r="22" fill="none" stroke={MF.line} strokeWidth="6" />
                    <circle cx="28" cy="28" r="22" fill="none" stroke={sel.score > 75 ? MF.ok : MF.accent} strokeWidth="6" strokeLinecap="round"
                            strokeDasharray={`${Math.PI * 44 * (sel.score / 100)} ${Math.PI * 44}`} />
                  </svg>
                  <div className="mf-col" style={{ gap: 0 }}>
                    <div className="app-h1" style={{ fontSize: 24 }}>{sel.score}</div>
                    <div className="mf-ink3" style={{ fontSize: 11 }}>vs. accepted avg 72</div>
                  </div>
                </div>
                <hr className="mf-rule" style={{ margin: '12px 0' }} />
                <div className="mf-col mf-g4" style={{ fontSize: 11 }}>
                  <div className="mf-between"><span className="mf-ink3">Liability</span><span className="mf-mono">strong</span></div>
                  <div className="mf-between"><span className="mf-ink3">Damages</span><span className="mf-mono">mod</span></div>
                  <div className="mf-between"><span className="mf-ink3">Defendant ability</span><span className="mf-mono">good (muni)</span></div>
                  <div className="mf-between"><span className="mf-ink3">Statute window</span><span className="mf-mono">164d</span></div>
                </div>
              </div>
            </div>

            <div className="mf-card">
              <div className="mf-p12 mf-hl" style={{ fontWeight: 600 }}>Automations · would run on convert</div>
              <div className="mf-col">
                {[
                  ['bolt',   'Open matter · §1983 template (file no. auto)',        'ready'],
                  ['cal',    'Calendar CGIA deadline (182d from 2026-03-12)',       'ready'],
                  ['shield', 'Conflict check · re-run on all parties',              'passed'],
                  ['file',   'Generate engagement letter + HIPAA + CORA auths',    'ready'],
                  ['mail',   'Send welcome email · ES locale',                     'ready'],
                ].map((r, i, a) => (
                  <div key={i} className="mf-row mf-g10 mf-p10 mf-ai" style={{ borderBottom: i < a.length - 1 ? `1px solid ${MF.line}` : 'none' }}>
                    <Icon n={r[0]} size={14} style={{ color: MF.ink3 }} />
                    <div style={{ flex: 1, fontSize: 12.5 }}>{r[1]}</div>
                    <Chip ok={r[2] === 'passed'} ghost={r[2] !== 'passed'}>{r[2]}</Chip>
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

// ── CALENDAR ────────────────────────────────────────────────────────────────
function PageCalendar({ go }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dates = [27, 28, 29, 30, 1, 2, 3];
  const hours = ['8a', '9a', '10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p'];
  const events = [
    { d: 0, s: 1, e: 2.5, t: 'Expert call · Dr. Singh',      m: 'Alvarez',  c: '#3d83b8' },
    { d: 0, s: 4, e: 5,   t: 'Team standup',                 m: 'firm',     c: MF.ink3 },
    { d: 1, s: 2, e: 3.5, t: 'Meet & confer · Williams',     m: 'Williams', c: '#3d83b8' },
    { d: 1, s: 5, e: 6.5, t: 'Brief writing · block',        m: 'Aurora',   c: '#8a6a2d' },
    { d: 2, s: 0, e: 1,   t: 'CGIA deadline · Alvarez',      m: 'deadline', c: MF.warn, deadline: true },
    { d: 2, s: 1, e: 2,   t: 'Intake · Perez',               m: 'intake',   c: '#2d8a5f' },
    { d: 2, s: 4, e: 7,   t: 'Deposition prep · Officer Doe',m: 'Alvarez',  c: '#3d83b8' },
    { d: 3, s: 1, e: 2,   t: 'Client update · Moreno',       m: 'Moreno',   c: '#b6623d' },
    { d: 3, s: 3, e: 5,   t: 'Partner review',               m: 'firm',     c: MF.ink3 },
    { d: 4, s: 2, e: 4,   t: 'Settlement conf. · Williams',  m: 'Williams', c: '#3d83b8' },
  ];
  return (
    <AppShell path="calendar" go={go} topbar={
      <AppTopBar
        crumbs="CALENDAR"
        title="Week of Apr 27"
        sub={<span className="mf-ink3">9 deadlines · 12 events · 2 critical</span>}
        right={<>
          <GlobalSearch />
          <Seg options={['Day', 'Week', 'Month', 'Deadlines']} value="Week" />
          <Btn icon="filter">Calendars</Btn>
          <Btn primary icon="plus">Event</Btn>
        </>}
      />
    }>
      <div className="mf-row mf-flex1" style={{ overflow: 'hidden', minHeight: 0 }}>
        <div className="mf-col mf-flex1 mf-scroll" style={{ overflow: 'auto' }}>
          {/* day header */}
          <div style={{ display: 'grid', gridTemplateColumns: '54px repeat(7, 1fr)', borderBottom: `1px solid ${MF.line}`, background: MF.card, position: 'sticky', top: 0, zIndex: 2 }}>
            <div />
            {days.map((d, i) => (
              <div key={d} className="mf-col mf-p10" style={{ alignItems: 'center', gap: 2, borderLeft: `1px solid ${MF.line}` }}>
                <div className="mf-ink3" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em' }}>{d}</div>
                <div className="app-h1" style={{ fontSize: 18, color: i === 2 ? MF.accent : MF.ink }}>{dates[i]}</div>
              </div>
            ))}
          </div>
          {/* grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '54px repeat(7, 1fr)', position: 'relative', flex: 1 }}>
            <div className="mf-col" style={{ borderRight: `1px solid ${MF.line}` }}>
              {hours.map(h => <div key={h} className="mf-ink4 mf-mono" style={{ height: 48, fontSize: 10, padding: '4px 6px', textAlign: 'right' }}>{h}</div>)}
            </div>
            {days.map((d, di) => (
              <div key={d} style={{ borderLeft: `1px solid ${MF.line}`, position: 'relative' }}>
                {hours.map((_, hi) => <div key={hi} style={{ height: 48, borderBottom: `1px solid ${MF.line}` }} />)}
                {events.filter(e => e.d === di).map((e, i) => (
                  <div key={i} style={{
                    position: 'absolute', left: 4, right: 4,
                    top: e.s * 48, height: (e.e - e.s) * 48 - 2,
                    background: e.deadline ? '#fdf4ec' : `color-mix(in oklch, ${e.c} 16%, #fff)`,
                    borderLeft: `3px solid ${e.c}`,
                    borderRadius: 4, padding: '4px 6px', fontSize: 11, cursor: 'pointer',
                    color: MF.ink, overflow: 'hidden',
                  }}>
                    <div style={{ fontWeight: 500, lineHeight: 1.2 }}>{e.deadline && '⚠ '}{e.t}</div>
                    <div className="mf-ink3 mf-mono" style={{ fontSize: 9.5, marginTop: 2 }}>{e.m}</div>
                  </div>
                ))}
                {di === 2 && (
                  <div style={{ position: 'absolute', left: 0, right: 0, top: 2.4 * 48, height: 2, background: MF.warn, zIndex: 3 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: MF.warn, marginTop: -3, marginLeft: -2 }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mf-col" style={{ width: 280, borderLeft: `1px solid ${MF.line}`, background: MF.card }}>
          <div className="mf-p12 mf-hl" style={{ fontWeight: 600, fontSize: 12.5 }}>Deadlines · next 30d</div>
          <div className="mf-col mf-scroll" style={{ overflowY: 'auto' }}>
            {[
              ['Apr 30', 'Rivera · distribution',        'critical', '#3d83b8'],
              ['May 12', 'Alvarez · CGIA notice',        'critical', '#3d83b8'],
              ['May 15', 'Williams · Rule 26',           'auto',     '#3d83b8'],
              ['May 20', 'Alvarez · CORA response',      'manual',   '#3d83b8'],
              ['May 28', 'Patel · HUD response',         'auto',     '#2d8a5f'],
              ['Jun 02', 'Alvarez · initial disclosures', 'auto',    '#3d83b8'],
              ['Jun 10', 'Aurora class · cert reply',    'auto',     '#8a6a2d'],
            ].map((d, i, a) => (
              <div key={i} className="mf-row mf-g8 mf-ai mf-p10" style={{ borderBottom: i < a.length - 1 ? `1px solid ${MF.line}` : 'none' }}>
                <span className="mf-dot" style={{ background: d[3] }} />
                <div className="mf-col mf-flex1" style={{ gap: 0 }}>
                  <div className="mf-mono" style={{ fontSize: 11, fontWeight: 600 }}>{d[0]}</div>
                  <div style={{ fontSize: 11.5 }}>{d[1]}</div>
                </div>
                {d[2] === 'critical' ? <Chip warn>crit</Chip> : d[2] === 'auto' ? <Chip>auto</Chip> : <Chip ghost>man</Chip>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ── SETTLEMENT DISTRIBUTION ─────────────────────────────────────────────────
function PageSettlement({ id, go }) {
  return (
    <AppShell path={`settlement/${id}`} go={go} topbar={
      <AppTopBar
        crumbs={<span><span style={{ cursor: 'pointer' }} onClick={() => go('matters')}>Matters</span> / <span style={{ cursor: 'pointer' }} onClick={() => go('matter/rivera')}>Rivera v. Lakewood</span></span>}
        title="Settlement · distribution"
        sub={<Chip accent style={{ marginLeft: 8 }}>ready to disburse</Chip>}
        right={<>
          <GlobalSearch />
          <Btn icon="file">Print trust ledger</Btn>
          <Btn primary icon="check">Approve & disburse</Btn>
        </>}
      />
    }>
      <div className="mf-scroll" style={{ overflowY: 'auto', flex: 1 }}>
        <div className="mf-p16 mf-col mf-g12" style={{ padding: 20, maxWidth: 980, margin: '0 auto' }}>

          <div className="mf-row mf-g12">
            <div className="mf-card mf-flex1 mf-p14">
              <div className="mf-ink4" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em' }}>Gross settlement</div>
              <div className="app-h1" style={{ fontSize: 32, marginTop: 4 }}>$425,000.00</div>
              <div className="mf-ink3" style={{ fontSize: 12 }}>Lakewood · wire · deposited Apr 19</div>
            </div>
            <div className="mf-card mf-p14" style={{ width: 260 }}>
              <div className="mf-ink4" style={{ fontSize: 10.5, textTransform: 'uppercase' }}>Client net</div>
              <div className="app-h1" style={{ fontSize: 24, marginTop: 4 }}>$228,790.00</div>
              <div className="mf-ink3" style={{ fontSize: 12 }}>after all obligations</div>
            </div>
            <div className="mf-card mf-p14" style={{ width: 260 }}>
              <div className="mf-ink4" style={{ fontSize: 10.5, textTransform: 'uppercase' }}>Firm fee + costs</div>
              <div className="app-h1" style={{ fontSize: 24, marginTop: 4 }}>$181,240.00</div>
              <div className="mf-ink3" style={{ fontSize: 12 }}>40% fee + $11,240 costs</div>
            </div>
          </div>

          {/* breakdown waterfall */}
          <div className="mf-card mf-p14">
            <div className="mf-sec">Disbursement waterfall</div>
            <div className="mf-col mf-g2" style={{ marginTop: 12 }}>
              {[
                ['Gross settlement',                '$425,000.00',  '#14181f', 100, 'plus'],
                ['− Attorney fees (40%)',           '$170,000.00',  '#3d83b8', 40,  'minus'],
                ['− Advanced costs',                '$11,240.00',   '#b6623d', 2.6, 'minus'],
                ['− Medical liens (neg)',           '$14,970.00',   '#8a6a2d', 3.5, 'minus'],
                ['= Client net',                    '$228,790.00',  '#2d8a5f', 53.9, 'result'],
              ].map((r, i) => (
                <div key={i} className="mf-row mf-g10 mf-ai" style={{ padding: '8px 0', borderBottom: i < 4 ? `1px solid ${MF.line}` : 'none' }}>
                  <div style={{ fontSize: 12.5, width: 220, fontWeight: r[4] === 'result' ? 600 : 400 }}>{r[0]}</div>
                  <div style={{ flex: 1, background: MF.bg2, borderRadius: 3, height: 14, position: 'relative' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${r[3]}%`, background: r[2], borderRadius: 3, opacity: r[4] === 'result' ? 1 : .75 }} />
                  </div>
                  <div className="mf-mono" style={{ width: 120, textAlign: 'right', fontSize: 13, fontWeight: r[4] === 'result' ? 600 : 500, color: r[4] === 'minus' ? MF.ink3 : MF.ink }}>{r[1]}</div>
                </div>
              ))}
            </div>
          </div>

          {/* liens detail + approvals */}
          <div className="mf-row mf-g12">
            <div className="mf-card mf-flex1">
              <div className="mf-p12 mf-hl" style={{ fontWeight: 600 }}>Liens · negotiated</div>
              <table className="mf-table">
                <thead><tr><th>Lienholder</th><th>Original</th><th>Negotiated</th><th>Saved</th><th>Status</th></tr></thead>
                <tbody>
                  <tr><td>UCHealth</td><td className="mf-mono">$18,420</td><td className="mf-mono" style={{ fontWeight: 600 }}>$9,210</td><td className="mf-ok mf-mono">−50%</td><td><Chip ok>signed</Chip></td></tr>
                  <tr><td>Dr. Patel · PT</td><td className="mf-mono">$4,100</td><td className="mf-mono" style={{ fontWeight: 600 }}>$2,460</td><td className="mf-ok mf-mono">−40%</td><td><Chip ok>signed</Chip></td></tr>
                  <tr><td>Medicare · conditional</td><td className="mf-mono">$6,200</td><td className="mf-mono" style={{ fontWeight: 600 }}>$3,300</td><td className="mf-ok mf-mono">−47%</td><td><Chip ok>verified</Chip></td></tr>
                </tbody>
              </table>
              <div className="mf-p10 mf-between" style={{ background: MF.bg2 }}>
                <span className="mf-ink3" style={{ fontSize: 11.5 }}>Client saved $13,750 through negotiation</span>
                <Btn sm ghost>Lien letters</Btn>
              </div>
            </div>

            <div className="mf-card" style={{ width: 300 }}>
              <div className="mf-p12 mf-hl" style={{ fontWeight: 600 }}>Approvals</div>
              <div className="mf-col">
                {[
                  ['Client · Lakewood release signed', 'Rivera, A.', 'Apr 18', true],
                  ['Partner sign-off on distribution', 'J. Marsh',    'Apr 22', true],
                  ['Bookkeeper · trust reconciliation', 'R. Kim',     'Apr 22', true],
                  ['Managing partner · final',          'L. Kosloski', 'pending', false],
                ].map((r, i, a) => (
                  <div key={i} className="mf-row mf-g8 mf-p10 mf-ai" style={{ borderBottom: i < a.length - 1 ? `1px solid ${MF.line}` : 'none' }}>
                    <Icon n={r[3] ? 'check' : 'clock'} size={13} style={{ color: r[3] ? MF.ok : MF.ink3 }} />
                    <div className="mf-col mf-flex1" style={{ gap: 0 }}>
                      <div style={{ fontSize: 12 }}>{r[0]}</div>
                      <div className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>{r[1]} · {r[2]}</div>
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

// ── BILLING ─────────────────────────────────────────────────────────────────
function PageBilling({ go }) {
  return (
    <AppShell path="billing" go={go} topbar={
      <AppTopBar crumbs="BILLING" title="Invoicing & trust"
        sub={<span className="mf-ink3">$47,880 WIP · $19,200 unpaid · $432k in trust across 8 matters</span>}
        right={<><GlobalSearch /><Btn icon="download">Export</Btn><Btn primary icon="plus">New invoice</Btn></>} />
    }>
      <div className="mf-scroll" style={{ overflowY: 'auto', flex: 1 }}>
        <div className="mf-p16 mf-col mf-g12" style={{ padding: 20 }}>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
            {[
              ['WIP', '$47,880', '118.2h unbilled'],
              ['Invoiced · MTD', '$62,400', '14 invoices'],
              ['A/R', '$19,200', '4 overdue · avg 38d'],
              ['Trust', '$432,130', '8 matters'],
            ].map(c => (
              <div key={c[0]} className="mf-card mf-p14">
                <div className="mf-ink4" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em' }}>{c[0]}</div>
                <div className="app-h1" style={{ fontSize: 26, marginTop: 4 }}>{c[1]}</div>
                <div className="mf-ink3" style={{ fontSize: 11.5 }}>{c[2]}</div>
              </div>
            ))}
          </div>

          <div className="mf-card">
            <div className="mf-between mf-p12 mf-hl">
              <div style={{ fontWeight: 600 }}>Open invoices</div>
              <Seg options={['All', 'Overdue', 'Due soon', 'Paid']} value="All" />
            </div>
            <table className="mf-table">
              <thead><tr><th>#</th><th>Client</th><th>Matter</th><th>Date</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {[
                  ['2026-041', 'Patel, R.',   'FHA',               'Apr 15', '$6,420',  'May 15', 'open'],
                  ['2026-040', 'Moreno, E.',  'CADA',              'Apr 14', '$3,920',  'May 14', 'open'],
                  ['2026-039', 'Nguyen, T.',  'DUI · flat',        'Apr 10', '$3,500',  'Apr 24', 'overdue'],
                  ['2026-038', 'Ellis fam.',  'IDEA',              'Apr 08', '$1,240',  'May 08', 'open'],
                  ['2026-037', 'Rodriguez',   'FHA',               'Apr 01', '$2,170',  'May 01', 'open'],
                  ['2026-036', 'Chen, M.',    'ADA transit',       'Mar 28', '$4,820',  'Apr 27', 'overdue'],
                  ['2026-035', 'Patel, R.',   'FHA',               'Mar 15', '$5,140',  'Apr 14', 'paid'],
                  ['2026-034', 'Jenner, D.',  'Employment',        'Mar 10', '$8,920',  'Apr 09', 'paid'],
                ].map((r, i) => (
                  <tr key={i}>
                    <td className="mf-mono" style={{ fontSize: 11 }}>{r[0]}</td>
                    <td style={{ fontWeight: 500 }}>{r[1]}</td>
                    <td className="mf-ink3">{r[2]}</td>
                    <td className="mf-mono" style={{ fontSize: 11 }}>{r[3]}</td>
                    <td className="mf-mono" style={{ fontWeight: 600 }}>{r[4]}</td>
                    <td className="mf-mono" style={{ fontSize: 11 }}>{r[5]}</td>
                    <td>
                      {r[6] === 'overdue' ? <Chip warn>overdue</Chip>
                       : r[6] === 'paid'  ? <Chip ok>paid</Chip>
                       : <Chip>open</Chip>}
                    </td>
                    <td><Btn sm ghost>Open</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mf-row mf-g12">
            <div className="mf-card mf-flex1 mf-p12">
              <div className="mf-between"><div style={{ fontWeight: 600 }}>Trust · by matter</div><Btn sm icon="file">Reconcile</Btn></div>
              <div className="mf-col mf-g6" style={{ marginTop: 10 }}>
                {[
                  ['Rivera v. Lakewood',   425000, '#3d83b8', 'settled · distribute'],
                  ['Alvarez v. Aurora',      5000, '#3d83b8', 'costs reserve'],
                  ['Patel · FHA',            4120, '#2d8a5f', 'advance'],
                  ['Nguyen · DUI',           3500, '#7a5aa6', 'flat · held'],
                  ['Moreno · CADA',          2500, '#b6623d', 'advance'],
                  ['Rodriguez · FHA',        1200, '#2d8a5f', 'advance'],
                  ['Lin, K. · intake',         500, MF.ink3,  'consult'],
                  ['Cisneros · consult',       500, MF.ink3,  'consult'],
                ].map((r, i) => {
                  const pct = (r[1] / 432000) * 100;
                  return (
                    <div key={i} className="mf-row mf-g10 mf-ai">
                      <span className="mf-dot" style={{ background: r[2] }} />
                      <div className="mf-col mf-flex1" style={{ gap: 2 }}>
                        <div className="mf-between"><span style={{ fontSize: 12 }}>{r[0]}</span><span className="mf-mono" style={{ fontSize: 11, fontWeight: 600 }}>${r[1].toLocaleString()}</span></div>
                        <div style={{ height: 4, background: MF.bg2, borderRadius: 2 }}>
                          <div style={{ width: Math.max(2, pct) + '%', height: '100%', background: r[2], borderRadius: 2, opacity: .75 }} />
                        </div>
                      </div>
                      <span className="mf-ink4 mf-mono" style={{ fontSize: 10, width: 100, textAlign: 'right' }}>{r[3]}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mf-card" style={{ width: 320 }}>
              <div className="mf-p12 mf-hl" style={{ fontWeight: 600 }}>Collections health</div>
              <div className="mf-col mf-p12 mf-g8">
                {[
                  ['0–30 days', '$12,580', 66, MF.ok],
                  ['31–60 days', '$4,320',  22, MF.accent],
                  ['61–90 days', '$1,800',   9, '#8a6a2d'],
                  ['90+ days',   '$500',     3, MF.warn],
                ].map((r, i) => (
                  <div key={i} className="mf-col" style={{ gap: 3 }}>
                    <div className="mf-between" style={{ fontSize: 11 }}><span className="mf-ink3">{r[0]}</span><span className="mf-mono" style={{ fontWeight: 600 }}>{r[1]}</span></div>
                    <div style={{ height: 6, background: MF.bg2, borderRadius: 3 }}>
                      <div style={{ width: r[2] + '%', height: '100%', background: r[3], borderRadius: 3 }} />
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

// ── TIME ────────────────────────────────────────────────────────────────────
function PageTime({ go }) {
  return (
    <AppShell path="time" go={go} topbar={
      <AppTopBar crumbs="TIME" title="My time · April"
        sub={<span className="mf-ink3">142.6h logged · 118.2h billable · 83% util.</span>}
        right={<><GlobalSearch /><Seg options={['Day', 'Week', 'Month']} value="Month" /><Btn primary icon="plus">Log time</Btn></>} />
    }>
      <div className="mf-scroll" style={{ overflowY: 'auto', flex: 1 }}>
        <div className="mf-p16 mf-col mf-g12" style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
            {[['Logged', '142.6h', 'month-to-date'], ['Billable', '118.2h', '83%'], ['WIP $', '$47,880', 'unbilled'], ['Target', '160h', 'on pace']].map(c => (
              <div key={c[0]} className="mf-card mf-p14">
                <div className="mf-ink4" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>{c[0]}</div>
                <div className="app-h1" style={{ fontSize: 26, marginTop: 4 }}>{c[1]}</div>
                <div className="mf-ink3" style={{ fontSize: 11.5 }}>{c[2]}</div>
              </div>
            ))}
          </div>

          <div className="mf-card mf-p12">
            <div className="mf-between"><div style={{ fontWeight: 600 }}>Month · daily hours</div><span className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>goal: 8h/day</span></div>
            <div className="mf-row" style={{ gap: 4, marginTop: 12, alignItems: 'flex-end', height: 120 }}>
              {[6.2, 7.4, 8.1, 5.5, 9.2, 0, 0, 7.8, 8.4, 6.9, 7.1, 9.5, 8.2, 0, 0, 8.0, 7.5, 6.8, 9.2, 8.4, 0, 0, 7.8, 8.5, 6.2, 7.9].map((h, i) => (
                <div key={i} className="mf-col mf-flex1" style={{ alignItems: 'center', gap: 2 }}>
                  <div style={{ width: '100%', height: `${(h / 10) * 100}%`, background: h >= 8 ? MF.accent : h > 0 ? `color-mix(in oklch, ${MF.accent} 55%, #fff)` : MF.line, borderRadius: 2, minHeight: 2 }} />
                  <div className="mf-ink4 mf-mono" style={{ fontSize: 9 }}>{i + 1}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mf-card">
            <div className="mf-between mf-p12 mf-hl"><div style={{ fontWeight: 600 }}>Entries · last 7 days</div><Btn sm icon="filter">Matter</Btn></div>
            <table className="mf-table">
              <thead><tr><th>Date</th><th>Matter</th><th>Activity</th><th>Hours</th><th>Rate</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {[
                  ['Apr 22', 'Alvarez',  'Motion to compel · draft & file',   '3.4', '$550', '$1,870', 'billable'],
                  ['Apr 22', 'Williams', 'Meet & confer prep',                '1.2', '$550', '$660',   'billable'],
                  ['Apr 21', 'Aurora',   'Class cert · brief writing',        '5.6', '$550', '$3,080', 'billable'],
                  ['Apr 21', '—',        'Firm admin · hiring',                '1.0', '—',    '—',     'non-bill'],
                  ['Apr 20', 'Alvarez',  'Evidence review · BWC',             '2.8', '$550', '$1,540', 'billable'],
                  ['Apr 19', 'Moreno',   'Client call + follow-up',           '0.8', '$425', '$340',   'billable'],
                  ['Apr 18', 'Alvarez',  'Meet & confer',                      '1.0', '$550', '$550',   'billable'],
                ].map((r, i) => (
                  <tr key={i}>
                    <td className="mf-mono" style={{ fontSize: 11 }}>{r[0]}</td>
                    <td>{r[1]}</td>
                    <td>{r[2]}</td>
                    <td className="mf-mono" style={{ textAlign: 'right' }}>{r[3]}</td>
                    <td className="mf-mono mf-ink3" style={{ fontSize: 11 }}>{r[4]}</td>
                    <td className="mf-mono" style={{ fontWeight: 600 }}>{r[5]}</td>
                    <td>{r[6] === 'billable' ? <Chip ok>bill</Chip> : <Chip ghost>n/b</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ── placeholder-but-rich pages for the remaining nav items ──
function PageSimple({ path, title, crumbs, children, go }) {
  return (
    <AppShell path={path} go={go} topbar={<AppTopBar crumbs={crumbs} title={title} right={<GlobalSearch />} />}>
      <div className="mf-scroll" style={{ overflowY: 'auto', flex: 1 }}>
        <div className="mf-p16" style={{ padding: 20 }}>{children}</div>
      </div>
    </AppShell>
  );
}

function PageReports({ go }) {
  return <PageSimple path="reports" crumbs="REPORTS" title="Reports" go={go}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
      {[
        ['Revenue by practice area', 'Contingent fee realization by area · last 12m'],
        ['Case outcomes',           'Win/settle/dismiss · by judge, by area'],
        ['Pipeline health',          'Intake → retained → filed → resolved'],
        ['Utilization',              'Billable hours per attorney · target 160/mo'],
        ['Collections & A/R',        'Aging buckets · write-offs · realization'],
        ['Referral sources',         'Conversion rate by channel'],
      ].map(r => (
        <div key={r[0]} className="mf-card mf-p14 app-card-hover">
          <div className="mf-sec">Report</div>
          <div className="app-h1" style={{ fontSize: 18, marginTop: 4 }}>{r[0]}</div>
          <div className="mf-ink3" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>{r[1]}</div>
          <svg width="100%" height="50" viewBox="0 0 180 50" style={{ marginTop: 10 }}>
            {[...Array(12)].map((_, i) => {
              const h = 12 + ((i * 7 + 11) % 30);
              return <rect key={i} x={i * 15 + 2} y={48 - h} width="10" height={h} fill={MF.accent} opacity={.3 + i / 20} />;
            })}
          </svg>
        </div>
      ))}
    </div>
  </PageSimple>;
}

function PageAutomations({ go }) {
  const autos = [
    ['New §1983 matter · full onboarding',   '14 steps · engagement, CGIA calendar, conflict, CORA', true,  '18 runs / mo'],
    ['CADA 90-day clock',                     'On EEOC right-to-sue · auto-calendar',                 true,  '4 runs / mo'],
    ['FHA complaint · post-filing',           'Auto-send to HUD + sched 30d response',                true,  '2 runs / mo'],
    ['Settlement distribution',               'Trust ledger → 1099 → payout checklist',               true,  '6 runs / mo'],
    ['Body-cam sync',                         'On evidence upload · whisper + timeline',              true,  '12 runs / mo'],
    ['Lien letter — medical',                 'On settlement agreed · sends negotiation packet',      false, 'draft'],
    ['CORA follow-up',                        'On no-response in 3 biz days · sends demand',          true,  '9 runs / mo'],
    ['Client weekly update',                  'Every Fri · personalized per open matter',             false, 'paused'],
  ];
  return <PageSimple path="automations" crumbs="AUTOMATIONS" title="Firm automations" go={go}>
    <div className="mf-card">
      <div className="mf-between mf-p12 mf-hl">
        <div className="mf-row mf-g10 mf-ai"><div style={{ fontWeight: 600 }}>Rules</div><Chip ok>{autos.filter(a => a[2]).length} active</Chip><Chip ghost>{autos.filter(a => !a[2]).length} off</Chip></div>
        <Btn primary icon="plus">New automation</Btn>
      </div>
      <div className="mf-col">
        {autos.map((r, i, a) => (
          <div key={i} className="mf-row mf-g12 mf-p12 mf-ai" style={{ borderBottom: i < a.length - 1 ? `1px solid ${MF.line}` : 'none' }}>
            <Icon n="bolt" size={14} style={{ color: r[2] ? MF.accent : MF.ink4 }} />
            <div className="mf-col mf-flex1" style={{ gap: 2 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{r[0]}</div>
              <div className="mf-ink3" style={{ fontSize: 11.5 }}>{r[1]}</div>
            </div>
            <span className="mf-ink4 mf-mono" style={{ fontSize: 10.5, width: 110 }}>{r[3]}</span>
            <div className="mf-row mf-g6">
              <Btn sm ghost>Edit</Btn>
              <div style={{ width: 34, height: 18, background: r[2] ? MF.accent : MF.line, borderRadius: 10, position: 'relative', cursor: 'pointer' }}>
                <div style={{ position: 'absolute', top: 2, left: r[2] ? 18 : 2, width: 14, height: 14, borderRadius: 7, background: '#fff', transition: 'left .15s' }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </PageSimple>;
}

function PageSettings({ go }) {
  return <PageSimple path="settings" crumbs="SETTINGS" title="Firm settings" go={go}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
      {[
        ['Firm profile',      'Name, address, bar ID, tax'],
        ['People & access',   '6 members · 3 roles'],
        ['Practice areas',    '5 configured'],
        ['Fee structures',    'Contingent, hourly, flat, hybrid, pro bono'],
        ['Calendaring rules', 'CGIA, CADA, FHA, §1983, scheduling orders'],
        ['Document templates', '34 templates'],
        ['Integrations',      'PACER, CORA, Clio Payments, Fastcase'],
        ['Conflict DB',       '1,284 parties indexed'],
        ['Trust accounts',    '2 IOLTA · COLTAF compliance'],
      ].map(s => (
        <div key={s[0]} className="mf-card mf-p14 app-card-hover">
          <div style={{ fontSize: 13, fontWeight: 500 }}>{s[0]}</div>
          <div className="mf-ink3" style={{ fontSize: 11.5, marginTop: 4 }}>{s[1]}</div>
        </div>
      ))}
    </div>
  </PageSimple>;
}

// practice-area landing (simple filtered view)
function PageArea({ id, go }) {
  const labels = { '1983': '§1983 / civil rights', cada: 'Employment · CADA', fha: 'Housing · FHA', criminal: 'Criminal (flat)', class: 'Class actions' };
  return <PageSimple path={`area/${id}`} crumbs="PRACTICE AREAS" title={labels[id] || id} go={go}>
    <div className="mf-ink3" style={{ fontSize: 13, marginBottom: 12 }}>Matters, pipeline, deadlines, and reports filtered to {labels[id] || id}. ← <span style={{ cursor: 'pointer', color: MF.accent }} onClick={() => go('matters')}>see all matters</span></div>
    <div className="mf-card mf-p12">
      <div className="mf-sec">{labels[id] || id} · placeholder · shares the Matters layout pre-filtered.</div>
    </div>
  </PageSimple>;
}

Object.assign(window, { PageIntake, PageCalendar, PageSettlement, PageBilling, PageTime, PageReports, PageAutomations, PageSettings, PageArea });
