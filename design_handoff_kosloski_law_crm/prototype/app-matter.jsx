// Final prototype — Matter detail (signature page) + Intake + Calendar

// ── MATTER DETAIL ───────────────────────────────────────────────────────────
function PageMatter({ id, go }) {
  const [tab, setTab] = React.useState('overview');

  // shape per matter so ids feel real; only Alvarez is fully authored
  const matters = {
    alvarez: {
      name: 'Alvarez v. City of Aurora et al.',
      no: '2026-CV-00481',
      area: '§1983 · excessive force',
      court: 'D. Colorado · Hon. L. Martinez',
      stage: 'Discovery',
      filed: 'Jan 14, 2026',
      trial: 'Oct 5, 2026',
      opp: 'Ruben Alvarado · Aurora CAO',
      fee: 'Contingent · 40%',
      trust: '$5,000',
      wip: '$28,400 · 71.0h',
      team: [['JM', 'lead'], ['RK', 'paralegal'], ['LK', 'co-counsel'], ['MG', 'investigator']],
      client: 'Maria Alvarez',
    },
    williams: { name: 'Williams v. Denver', no: '2025-CV-02014', area: '§1983', court: 'D. Colorado', stage: 'Dispositive', filed: 'Aug 12, 2025', trial: 'Jul 2026', opp: 'Denver City Atty', fee: 'Contingent · 40%', trust: '$0', wip: '$14,200', team: [['JM', 'lead'], ['RK', '']], client: 'Derek Williams' },
    aurora:   { name: 'In re: Aurora class',  no: '2026-CV-00122', area: 'Class action', court: 'D. Colorado', stage: 'Cert', filed: 'Feb 2026', trial: '—', opp: 'Aurora CAO', fee: 'Contingent · 33%', trust: '$0', wip: '$41,800', team: [['LK', 'lead'], ['JM', '']], client: 'Class of 142' },
  };
  const m = matters[id] || matters.alvarez;

  return (
    <AppShell path={`matter/${id}`} go={go} topbar={
      <AppTopBar
        crumbs={<span><span style={{ cursor: 'pointer' }} onClick={() => go('matters')}>Matters</span> / {m.area}</span>}
        title={m.name}
        sub={
          <div className="mf-row mf-g6 mf-ai" style={{ marginLeft: 8 }}>
            <span className="mf-mono mf-ink3" style={{ fontSize: 11 }}>{m.no}</span>
            <Chip accent>{m.stage}</Chip>
            <Chip style={{ fontSize: 10 }}>{m.area}</Chip>
          </div>
        }
        right={<>
          <GlobalSearch />
          <Btn icon="clock">Start timer</Btn>
          <Btn icon="file">Generate doc</Btn>
          <Btn primary icon="plus">Action</Btn>
        </>}
        below={
          <div className="mf-row mf-g14 mf-ai" style={{ padding: '0 18px 2px', overflowX: 'auto' }}>
            {['overview', 'timeline', 'documents', 'emails', 'evidence', 'parties', 'deadlines', 'tasks', 'notes', 'billing'].map((t) => (
              <div key={t} onClick={() => setTab(t)}
                   style={{
                     padding: '8px 2px',
                     borderBottom: `2px solid ${tab === t ? MF.ink : 'transparent'}`,
                     color: tab === t ? MF.ink : MF.ink3,
                     fontSize: 12.5,
                     textTransform: 'capitalize',
                     cursor: 'pointer',
                     fontWeight: tab === t ? 500 : 400,
                   }}>{t}</div>
            ))}
          </div>
        }
      />
    }>
      <div className="mf-scroll" style={{ overflowY: 'auto', flex: 1 }}>
        {tab === 'overview'   && <MatterOverview m={m} go={go} />}
        {tab === 'timeline'   && <MatterTimeline go={go} />}
        {tab === 'documents'  && <MatterDocuments />}
        {tab === 'emails'     && <MatterEmails matterId={id} go={go} />}
        {tab === 'evidence'   && <MatterEvidence go={go} />}
        {tab === 'parties'    && <MatterParties />}
        {tab === 'deadlines'  && <MatterDeadlines />}
        {tab === 'tasks'      && <MatterTasks />}
        {tab === 'notes'      && <MatterNotes />}
        {tab === 'billing'    && <MatterBilling />}
      </div>
    </AppShell>
  );
}

// Overview = signature view: stats, timeline preview, parties, deadlines
function MatterOverview({ m, go }) {
  return (
    <div className="mf-p16 mf-col mf-g12" style={{ padding: 18 }}>

      {/* facts + team + $$ */}
      <div className="mf-row mf-g12" style={{ alignItems: 'stretch' }}>
        <div className="mf-card mf-flex1 mf-p14">
          <div className="mf-sec" style={{ marginBottom: 8 }}>Case facts</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              ['Court', m.court],
              ['Filed', m.filed],
              ['Trial', m.trial],
              ['Opposing', m.opp],
              ['Fee basis', m.fee],
              ['Trust held', m.trust],
              ['WIP', m.wip],
              ['Client', m.client],
            ].map(([k, v]) => (
              <div key={k} className="mf-col" style={{ gap: 1 }}>
                <div className="mf-ink4" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>{k}</div>
                <div style={{ fontSize: 12.5 }}>{v}</div>
              </div>
            ))}
          </div>
          <hr className="mf-rule" style={{ margin: '14px 0 10px' }} />
          <div className="mf-between mf-ai">
            <div className="mf-sec">Team</div>
            <span className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>{m.team.length} people</span>
          </div>
          <div className="mf-row mf-g8 mf-ai" style={{ marginTop: 8 }}>
            {m.team.map(([init, role], i) => (
              <div key={i} className="mf-row mf-g6 mf-ai">
                <Av initials={init} />
                <div className="mf-col" style={{ gap: 0 }}>
                  <span style={{ fontSize: 11.5 }}>{init === 'JM' ? 'Jane Marsh' : init === 'RK' ? 'Rachel Kim' : init === 'LK' ? 'Leo Kosloski' : 'Marco Guerra'}</span>
                  {role && <span className="mf-ink4" style={{ fontSize: 10 }}>{role}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mf-col mf-g12" style={{ width: 300 }}>
          <div className="mf-card mf-p12">
            <div className="mf-sec">Case value estimate</div>
            <div className="mf-row mf-g10 mf-ai" style={{ marginTop: 10 }}>
              <svg width="68" height="68" viewBox="0 0 68 68" className="app-ring">
                <circle cx="34" cy="34" r="28" fill="none" stroke={MF.line} strokeWidth="6" />
                <circle cx="34" cy="34" r="28" fill="none" stroke={MF.accent} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${Math.PI * 56 * 0.62} ${Math.PI * 56}`} />
              </svg>
              <div className="mf-col" style={{ gap: 2 }}>
                <div className="app-h1" style={{ fontSize: 22 }}>$380–520k</div>
                <div className="mf-ink3" style={{ fontSize: 11 }}>62% confidence · from 14 comps</div>
              </div>
            </div>
            <hr className="mf-rule" style={{ margin: '12px 0' }} />
            <div className="mf-row mf-g12">
              <div className="mf-col" style={{ gap: 0 }}><div className="mf-ink4" style={{ fontSize: 10, textTransform: 'uppercase' }}>Fee if won</div><div className="mf-mono" style={{ fontSize: 13, fontWeight: 600 }}>~$180k</div></div>
              <div className="mf-col" style={{ gap: 0 }}><div className="mf-ink4" style={{ fontSize: 10, textTransform: 'uppercase' }}>Costs-to-date</div><div className="mf-mono" style={{ fontSize: 13, fontWeight: 600 }}>$11,240</div></div>
            </div>
          </div>

          <div className="mf-card mf-p12">
            <div className="mf-sec">Next 3 deadlines</div>
            <div className="mf-col mf-g8" style={{ marginTop: 8 }}>
              {[
                ['May 12', 'CGIA notice due', 'critical'],
                ['May 20', 'CORA response',   'auto'],
                ['Jun 02', 'Rule 26 initial', 'auto'],
              ].map(([d, t, k], i) => (
                <div key={i} className="mf-row mf-g8 mf-ai">
                  <div className="mf-mono app-h1" style={{ fontSize: 16, width: 54, color: MF.ink }}>{d}</div>
                  <div style={{ flex: 1, fontSize: 12 }}>{t}</div>
                  {k === 'critical' ? <Chip warn>crit</Chip> : <Chip>auto</Chip>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* timeline + chatter */}
      <div className="mf-row mf-g12" style={{ alignItems: 'stretch' }}>
        <div className="mf-card mf-flex1">
          <div className="mf-between mf-p12 mf-hl">
            <div style={{ fontWeight: 600 }}>Case timeline</div>
            <Seg options={['All', 'Filings', 'Events', 'Comms']} value="All" />
          </div>
          <div className="mf-p14">
            <div style={{ position: 'relative', paddingLeft: 18 }}>
              <div style={{ position: 'absolute', left: 5, top: 10, bottom: 10, width: 2, background: MF.line }} />
              {[
                { d: 'Apr 22', dot: MF.accent, title: 'Filed: motion to compel CORA production',  meta: 'ECF 48 · JM · 1h ago' },
                { d: 'Apr 20', dot: MF.ink3,   title: 'Received: 3 body-cam clips (APD, Officer Doe #4412)', meta: 'Evidence · 14 min sync' },
                { d: 'Apr 18', dot: MF.ink3,   title: 'Meet & confer — opposing refused to produce internal affairs file', meta: 'Memo in matter notes' },
                { d: 'Apr 10', dot: MF.ok,     title: 'Deposed: Sgt. Carter (APD)', meta: 'Transcript ordered ($1,420 cost)' },
                { d: 'Mar 28', dot: MF.ink3,   title: 'Filed: Rule 26(f) discovery plan',  meta: 'ECF 31' },
                { d: 'Mar 02', dot: MF.ink3,   title: 'Scheduling order entered', meta: 'Judge Martinez' },
                { d: 'Feb 14', dot: MF.accent, title: 'Filed: 1st amended complaint',     meta: 'ECF 12' },
                { d: 'Jan 14', dot: MF.ink,    title: 'Complaint filed',                  meta: 'ECF 1 — case opened' },
              ].map((e, i) => (
                <div key={i} style={{ position: 'relative', paddingBottom: 12 }}>
                  <div style={{ position: 'absolute', left: -18, top: 4, width: 12, height: 12, borderRadius: 6, background: e.dot, border: '2px solid #fff' }} />
                  <div className="mf-row mf-g8 mf-ai">
                    <span className="mf-mono mf-ink4" style={{ fontSize: 10.5, width: 48 }}>{e.d}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{e.title}</span>
                  </div>
                  <div className="mf-ink3" style={{ fontSize: 11, marginLeft: 56 }}>{e.meta}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mf-card" style={{ width: 340 }}>
          <div className="mf-between mf-p12 mf-hl">
            <div style={{ fontWeight: 600 }}>Internal chatter</div>
            <Chip ghost>#alvarez</Chip>
          </div>
          <div className="mf-col mf-p10 mf-g12" style={{ overflowY: 'auto', maxHeight: 460 }}>
            {[
              ['RK', 'Rachel Kim',    '2h', 'CGIA notice draft ready — tagged you for review in Documents.'],
              ['JM', 'Jane Marsh',    '3h', '@MG we still missing the 2023 UOF report on Doe? CAO is being cute.'],
              ['MG', 'Marco Guerra',  '4h', 'Have it. CORA ref #A-2023-441 — uploading now, will OCR + redact.'],
              ['LK', 'Leo Kosloski',  '1d', 'Comps updated — two Aurora settlements from Q1 support $400k-range.'],
              ['RK', 'Rachel Kim',    '2d', 'Client says she can do 10am Thurs for prep. Added to calendar.'],
            ].map((c, i) => (
              <div key={i} className="mf-row mf-g8 mf-as">
                <Av initials={c[0]} />
                <div className="mf-col mf-flex1" style={{ gap: 1 }}>
                  <div className="mf-row mf-g6 mf-ai"><span style={{ fontSize: 11.5, fontWeight: 500 }}>{c[1]}</span><span className="mf-ink4" style={{ fontSize: 10 }}>{c[2]}</span></div>
                  <div style={{ fontSize: 12, lineHeight: 1.5 }}>{c[3]}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mf-hl" />
          <div className="mf-row mf-g6 mf-ai mf-p10">
            <input className="mf-input" style={{ flex: 1 }} placeholder="Message the team… (@ to tag)" />
            <Btn sm primary>Send</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// Timeline (fuller)
function MatterTimeline({ go }) {
  return (
    <div className="mf-p16" style={{ padding: 18, maxWidth: 900, margin: '0 auto' }}>
      <div className="mf-card mf-p16">
        <div className="mf-sec">Full case timeline · 34 events</div>
        <div className="mf-ink3" style={{ fontSize: 12, marginTop: 4 }}>Jan 2026 → today. Filter: everything.</div>
        <hr className="mf-rule" style={{ margin: '14px 0' }} />
        <div style={{ position: 'relative', paddingLeft: 20 }}>
          <div style={{ position: 'absolute', left: 6, top: 4, bottom: 4, width: 2, background: MF.line }} />
          {[...Array(14)].map((_, i) => {
            const months = ['Apr 22', 'Apr 20', 'Apr 18', 'Apr 10', 'Apr 02', 'Mar 28', 'Mar 14', 'Mar 02', 'Feb 24', 'Feb 14', 'Feb 03', 'Jan 28', 'Jan 19', 'Jan 14'];
            const titles = ['Motion to compel filed', 'Body-cam evidence received', 'Meet & confer', 'Deposition — Sgt. Carter', 'Initial disclosures sent', 'Rule 26(f) filed', 'IA file CORA request sent', 'Scheduling order', 'Answer received', 'Amended complaint', 'TRO hearing — denied', 'Conflict check cleared', 'Engagement signed', 'Complaint filed'];
            return (
              <div key={i} style={{ position: 'relative', paddingBottom: 14 }}>
                <div style={{ position: 'absolute', left: -20, top: 6, width: 12, height: 12, borderRadius: 6, background: i % 3 === 0 ? MF.accent : MF.ink3, border: '2px solid #fff' }} />
                <div className="mf-row mf-g10 mf-ai">
                  <span className="mf-mono mf-ink4" style={{ fontSize: 11, width: 60 }}>{months[i]}</span>
                  <span style={{ fontSize: 13 }}>{titles[i]}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Documents
function MatterDocuments() {
  const docs = [
    ['file', 'Complaint — Alvarez v. Aurora',        'ECF 1',  'Jan 14', 'filed'],
    ['file', 'Amended complaint',                    'ECF 12', 'Feb 14', 'filed'],
    ['file', 'Answer · defendants',                  'ECF 15', 'Feb 24', 'received'],
    ['file', 'Rule 26(f) discovery plan',            'ECF 31', 'Mar 28', 'filed'],
    ['file', 'CGIA notice — draft v3',               'work',   'Apr 22', 'review'],
    ['file', 'Motion to compel CORA production',     'ECF 48', 'Apr 22', 'filed'],
    ['file', 'Deposition transcript — Carter',       'vendor', 'Apr 12', 'received'],
    ['file', 'Engagement letter — executed',         'intake', 'Jan 11', 'archived'],
  ];
  return (
    <div className="mf-p16" style={{ padding: 18 }}>
      <div className="mf-card">
        <div className="mf-between mf-p12 mf-hl">
          <div style={{ fontWeight: 600 }}>Documents · 47</div>
          <div className="mf-row mf-g6">
            <Btn sm icon="filter">Filter</Btn>
            <Btn sm icon="plus">Upload</Btn>
            <Btn sm primary icon="file">Generate</Btn>
          </div>
        </div>
        <table className="mf-table">
          <thead><tr>
            <th></th><th>Name</th><th>Source</th><th>Date</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {docs.map((d, i) => (
              <tr key={i}>
                <td><Icon n={d[0]} size={14} style={{ color: MF.ink3 }} /></td>
                <td style={{ fontWeight: 500 }}>{d[1]}</td>
                <td className="mf-mono mf-ink3" style={{ fontSize: 11 }}>{d[2]}</td>
                <td className="mf-mono" style={{ fontSize: 11 }}>{d[3]}</td>
                <td>
                  {d[4] === 'filed'    && <Chip accent>filed</Chip>}
                  {d[4] === 'received' && <Chip>received</Chip>}
                  {d[4] === 'review'   && <Chip warn>review</Chip>}
                  {d[4] === 'archived' && <Chip ghost>archived</Chip>}
                </td>
                <td><Btn sm ghost>Open</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Evidence (signature — body-cam viewer)
function MatterEvidence({ go }) {
  return (
    <div className="mf-p16 mf-col mf-g12" style={{ padding: 18 }}>
      <div className="mf-card" style={{ overflow: 'hidden' }}>
        <div className="mf-between mf-p12 mf-hl">
          <div style={{ fontWeight: 600 }}>Evidence · Officer Doe #4412 body-cam · clip 2 of 3</div>
          <div className="mf-row mf-g8 mf-ai">
            <Chip style={{ fontSize: 10 }}>BWC_20240314_223412.mp4</Chip>
            <Chip ok>synced · 14:32</Chip>
            <Btn sm icon="link">Copy timecode</Btn>
          </div>
        </div>
        {/* viewport */}
        <div style={{ background: '#0a0d12', aspectRatio: '16/7', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a3040', fontFamily: MF.fMono, fontSize: 11 }}>
            [ body-worn camera · 720p · 14:32 / 28:14 ]
          </div>
          {/* metadata HUD */}
          <div style={{ position: 'absolute', top: 10, left: 10, color: '#8a95ab', fontFamily: MF.fMono, fontSize: 10, lineHeight: 1.6 }}>
            2024-03-14 22:34:12 UTC<br />
            39.7294° N, 104.8319° W<br />
            Officer: Doe, J. (#4412) · APD<br />
            Incident: 2024-APD-1139
          </div>
          <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(193,60,60,0.9)', color: '#fff', padding: '3px 8px', borderRadius: 3, fontFamily: MF.fMono, fontSize: 10 }}>● REC</div>
          <div style={{ position: 'absolute', bottom: 10, left: 10, right: 10, display: 'flex', alignItems: 'center', gap: 10, color: '#8a95ab' }}>
            <Icon n="play" size={16} style={{ color: '#d9e7f1' }} />
            <div style={{ flex: 1, height: 3, background: '#1a2030', borderRadius: 2, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '52%', background: MF.accent, borderRadius: 2 }} />
            </div>
            <span className="mf-mono" style={{ fontSize: 10, color: '#d9e7f1' }}>14:32 / 28:14</span>
          </div>
        </div>
        {/* multi-track timeline */}
        <div className="mf-p12">
          <div className="mf-ink4 mf-mono" style={{ fontSize: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.08em' }}>Synchronized sources</div>
          {[
            { l: 'BWC · Doe #4412',      dur: 100, segs: [[0, 100, '#3d83b8']] },
            { l: 'BWC · Carter #2211',   dur: 88,  segs: [[4, 84, '#3d83b8']] },
            { l: 'Dashcam · A-14',       dur: 94,  segs: [[6, 94, '#3d83b8']] },
            { l: 'Dispatch audio',       dur: 100, segs: [[0, 100, '#2d8a5f']] },
            { l: 'CAD entries',          dur: 100, segs: [[0, 18, '#8a6a2d'], [22, 45, '#8a6a2d'], [60, 95, '#8a6a2d']] },
          ].map((t, i) => (
            <div key={i} className="mf-row mf-g8 mf-ai" style={{ marginBottom: 4 }}>
              <div className="mf-mono mf-ink3" style={{ fontSize: 10.5, width: 140, whiteSpace: 'nowrap' }}>{t.l}</div>
              <div style={{ flex: 1, height: 12, background: MF.bg2, borderRadius: 2, position: 'relative' }}>
                {t.segs.map(([s, e, c], j) => (
                  <div key={j} style={{ position: 'absolute', left: `${s}%`, width: `${e - s}%`, top: 1, bottom: 1, background: c, opacity: 0.65, borderRadius: 1 }} />
                ))}
                {/* playhead */}
                <div style={{ position: 'absolute', left: '52%', top: -2, bottom: -2, width: 2, background: MF.warn }} />
              </div>
              <span className="mf-mono mf-ink4" style={{ fontSize: 10, width: 40, textAlign: 'right' }}>{t.dur < 100 ? `−${100 - t.dur}%` : 'full'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* flagged moments + transcript */}
      <div className="mf-row mf-g12">
        <div className="mf-card mf-flex1">
          <div className="mf-p12 mf-hl" style={{ fontWeight: 600 }}>Flagged moments · 7</div>
          <div className="mf-col">
            {[
              ['14:32', 'Force applied — strike to ribcage', 'JM', 'critical'],
              ['14:41', 'Voice: "stop resisting" — subject appears still', 'RK', 'emphasis'],
              ['18:02', 'BWC muted by officer',              'JM', 'anomaly'],
              ['20:14', 'Supervisor arrives on scene',       'JM', ''],
              ['22:58', 'Medical requested · 6 min delay',   'RK', 'emphasis'],
              ['24:40', 'Subject in cuffs, continued force', 'JM', 'critical'],
              ['26:12', 'Transport begins',                  'RK', ''],
            ].map((r, i, arr) => (
              <div key={i} className="mf-row mf-g10 mf-p10 mf-ai" style={{ borderBottom: i < arr.length - 1 ? `1px solid ${MF.line}` : 'none', cursor: 'pointer', background: i === 0 ? MF.accentSoft : undefined }}>
                <div className="mf-mono" style={{ fontSize: 11.5, width: 44, color: i === 0 ? MF.accent : MF.ink, fontWeight: 600 }}>{r[0]}</div>
                <div style={{ flex: 1, fontSize: 12 }}>{r[1]}</div>
                <Av initials={r[2]} />
                {r[3] === 'critical' && <Chip warn>crit</Chip>}
                {r[3] === 'emphasis' && <Chip accent>note</Chip>}
                {r[3] === 'anomaly'  && <Chip hi>anom.</Chip>}
              </div>
            ))}
          </div>
        </div>

        <div className="mf-card" style={{ width: 380 }}>
          <div className="mf-p12 mf-hl" style={{ fontWeight: 600 }}>Transcript · whisper v3 · 96% conf.</div>
          <div className="mf-p10 mf-col mf-g8" style={{ overflowY: 'auto', maxHeight: 420, fontSize: 12 }}>
            {[
              ['14:28', 'Officer Doe', 'Put your hands behind your back now.'],
              ['14:30', 'Alvarez',     '(unintelligible) — my shoulder —'],
              ['14:32', 'Officer Doe', 'Stop resisting. Stop resisting.', true],
              ['14:35', 'Carter',      'Doe, ease up, she\'s down.'],
              ['14:41', 'Officer Doe', 'Stop resisting.'],
              ['14:48', 'Alvarez',     'I\'m not —'],
              ['15:02', 'Dispatch',    'Unit 14, status?'],
              ['15:10', 'Carter',      'On scene, one in custody, medical en route.'],
            ].map((l, i) => (
              <div key={i} className="mf-col" style={{ background: l[3] ? MF.accentSoft : 'transparent', padding: 6, borderRadius: 4, gap: 0 }}>
                <div className="mf-row mf-g8 mf-ai"><span className="mf-mono mf-ink4" style={{ fontSize: 10 }}>{l[0]}</span><span style={{ fontSize: 11, fontWeight: 600 }}>{l[1]}</span></div>
                <div style={{ marginLeft: 42 }}>{l[2]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Parties
function MatterParties() {
  return (
    <div className="mf-p16" style={{ padding: 18 }}>
      <div className="mf-card mf-p12">
        <div className="mf-sec">Parties · 7</div>
        <table className="mf-table" style={{ marginTop: 10 }}>
          <thead><tr><th>Party</th><th>Role</th><th>Represented by</th><th>Contact</th><th>Conflict check</th></tr></thead>
          <tbody>
            {[
              ['Maria Alvarez', 'plaintiff', 'Kosloski Law (us)', 'maria.alvarez@email · (303) 555-0182', 'clear'],
              ['City of Aurora', 'defendant', 'Aurora CAO · R. Alvarado', 'r.alvarado@aurora.gov', 'clear'],
              ['Officer J. Doe #4412', 'defendant', 'Aurora CAO', '—', 'clear'],
              ['Sgt. Carter #2211', 'witness', 'APD Legal', 'deposed Apr 10', 'clear'],
              ['APD (entity)', 'defendant', 'Aurora CAO', '—', 'clear'],
              ['Dr. M. Singh', 'treating physician', '—', 'msingh@ohealth.org', 'clear'],
              ['E. Brown', 'witness', '—', '(720) 555-0110', 'clear'],
            ].map((p, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 500 }}>{p[0]}</td>
                <td><Chip style={{ fontSize: 10 }}>{p[1]}</Chip></td>
                <td>{p[2]}</td>
                <td className="mf-mono mf-ink3" style={{ fontSize: 11 }}>{p[3]}</td>
                <td><Chip ok>clear</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatterDeadlines() {
  return (
    <div className="mf-p16" style={{ padding: 18 }}>
      <div className="mf-card mf-p12">
        <div className="mf-between">
          <div className="mf-sec">Deadlines · driven by CO §1983 + D. Colo. scheduling order</div>
          <Btn sm icon="bolt">Re-run rules</Btn>
        </div>
        <table className="mf-table" style={{ marginTop: 10 }}>
          <thead><tr><th>Due</th><th>Event</th><th>Source</th><th>Owner</th><th>Status</th></tr></thead>
          <tbody>
            {[
              ['May 12', 'CGIA notice of claim',          'CRS §24-10-109 · 182d from incident', 'JM', 'critical'],
              ['May 20', 'CORA response deadline',        'CRS §24-72-203 · 3 biz days',         'RK', 'auto'],
              ['Jun 02', 'Rule 26 initial disclosures',   'Scheduling order',                    'JM', 'auto'],
              ['Jul 15', 'Expert disclosures — pltf',     'Scheduling order',                    'JM', 'auto'],
              ['Aug 30', 'Discovery cutoff',              'Scheduling order',                    'JM', 'auto'],
              ['Sep 15', 'Dispositive motions',           'Scheduling order',                    'JM', 'auto'],
              ['Oct 05', 'Trial',                         'Scheduling order',                    'JM', 'anchor'],
            ].map((r, i) => (
              <tr key={i}>
                <td className="mf-mono" style={{ fontSize: 11, fontWeight: 600 }}>{r[0]}</td>
                <td>{r[1]}</td>
                <td className="mf-ink3" style={{ fontSize: 11 }}>{r[2]}</td>
                <td><Av initials={r[3]} /></td>
                <td>
                  {r[4] === 'critical' && <Chip warn>critical</Chip>}
                  {r[4] === 'auto'     && <Chip>auto-rule</Chip>}
                  {r[4] === 'anchor'   && <Chip hi>anchor</Chip>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatterTasks() {
  const tasks = [
    ['Draft CGIA notice', 'RK', 'May 5', 'in-review', 2],
    ['Subpoena UOF training records', 'MG', 'May 1', 'open', 0],
    ['Prep outline — Officer Doe depo', 'JM', 'Jun 10', 'open', 3],
    ['Send medical records release', 'RK', 'Apr 28', 'done', 0],
    ['Confirm expert · forensic pathology', 'JM', 'Jul 1', 'open', 1],
    ['Draft opposition to MTD', 'LK', 'May 22', 'open', 0],
  ];
  return (
    <div className="mf-p16" style={{ padding: 18 }}>
      <div className="mf-card mf-p12">
        <div className="mf-between"><div className="mf-sec">Tasks · 11 open</div><Btn sm primary icon="plus">New task</Btn></div>
        <div className="mf-col mf-g6" style={{ marginTop: 10 }}>
          {tasks.map((t, i) => (
            <div key={i} className="mf-row mf-g10 mf-ai mf-p8" style={{ background: MF.bg2, borderRadius: 6 }}>
              <input type="checkbox" defaultChecked={t[3] === 'done'} style={{ accentColor: MF.ink }} />
              <div style={{ flex: 1, fontSize: 12.5, textDecoration: t[3] === 'done' ? 'line-through' : 'none', color: t[3] === 'done' ? MF.ink4 : MF.ink }}>{t[0]}</div>
              <Av initials={t[1]} />
              <span className="mf-mono mf-ink3" style={{ fontSize: 11, width: 48 }}>{t[2]}</span>
              {t[4] > 0 && <Chip style={{ fontSize: 10 }}><Icon n="mail" size={10} /> {t[4]}</Chip>}
              {t[3] === 'in-review' && <Chip warn>review</Chip>}
              {t[3] === 'done'      && <Chip ok>done</Chip>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MatterNotes() {
  return (
    <div className="mf-p16" style={{ padding: 18, maxWidth: 800, margin: '0 auto' }}>
      <div className="mf-card mf-p16">
        <div className="mf-between"><div className="mf-sec">Strategy memo</div><span className="mf-ink4 mf-mono" style={{ fontSize: 10 }}>edited 2h ago · JM</span></div>
        <div className="mf-col mf-g10" style={{ marginTop: 14, fontSize: 13, lineHeight: 1.65 }}>
          <p><strong>Theory of the case.</strong> Excessive force under §1983 + state-law assault/battery. Qualified immunity is the main fight — we need to establish the right was clearly established by Apr 2024.</p>
          <p><strong>Best evidence.</strong> Officer Doe's own BWC footage (14:32 strike sequence) + supervisor Carter's contemporaneous statement ("ease up, she's down") + Dr. Singh's orthopedic findings.</p>
          <p><strong>Risks.</strong> Aurora will cite <em>Kisela v. Hughes</em>. Counter with <em>Estate of Smart v. Aurora</em> (10th Cir. 2025) — factually on-point and clearly established.</p>
          <p><strong>Settlement posture.</strong> Comps support $380–520k. Won't engage seriously until after MTD ruling (~Jun). Floor: $300k.</p>
          <p><strong>Open questions.</strong> UOF history on Doe — still waiting on CORA compliance. If pattern shows, open Monell theory.</p>
        </div>
      </div>
    </div>
  );
}

function MatterBilling() {
  return (
    <div className="mf-p16 mf-col mf-g12" style={{ padding: 18 }}>
      <div className="mf-row mf-g12">
        {[['WIP', '$28,400', '71.0h logged'], ['Costs advanced', '$11,240', 'expert, transcripts, filings'], ['Trust', '$5,000', 'for costs only (contingent)'], ['Fee if won', '~$180k', '40% of $450k est.']].map(c => (
          <div key={c[0]} className="mf-card mf-flex1 mf-p14">
            <div className="mf-ink4" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>{c[0]}</div>
            <div className="app-h1" style={{ fontSize: 24, marginTop: 6 }}>{c[1]}</div>
            <div className="mf-ink3" style={{ fontSize: 11.5, marginTop: 2 }}>{c[2]}</div>
          </div>
        ))}
      </div>
      <div className="mf-card">
        <div className="mf-between mf-p12 mf-hl"><div style={{ fontWeight: 600 }}>Time · this matter</div><div className="mf-row mf-g6"><Seg options={['Week', 'Month', 'All']} value="Month" /><Btn sm icon="download">Export</Btn></div></div>
        <table className="mf-table">
          <thead><tr><th>Date</th><th>Who</th><th>Activity</th><th>Hrs</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>
            {[
              ['Apr 22', 'JM', 'Draft + file motion to compel',        '3.4', '$550', '$1,870.00'],
              ['Apr 22', 'RK', 'CGIA notice draft (v3)',               '2.1', '$195', '$409.50'],
              ['Apr 20', 'MG', 'Evidence sync + timeline (BWC/dash)',  '4.5', '$180', '$810.00'],
              ['Apr 18', 'JM', 'Meet & confer — opposing',             '1.0', '$550', '$550.00'],
              ['Apr 12', 'JM', 'Deposition — Sgt. Carter',             '6.8', '$550', '$3,740.00'],
              ['Apr 10', 'RK', 'Deposition prep + exhibits',           '3.2', '$195', '$624.00'],
              ['Apr 02', 'JM', 'Initial disclosures',                  '2.0', '$550', '$1,100.00'],
            ].map((r, i) => (
              <tr key={i}>
                <td className="mf-mono" style={{ fontSize: 11 }}>{r[0]}</td>
                <td><Av initials={r[1]} /></td>
                <td>{r[2]}</td>
                <td className="mf-mono" style={{ textAlign: 'right' }}>{r[3]}</td>
                <td className="mf-mono mf-ink3" style={{ fontSize: 11 }}>{r[4]}</td>
                <td className="mf-mono" style={{ fontWeight: 600 }}>{r[5]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

Object.assign(window, { PageMatter });
