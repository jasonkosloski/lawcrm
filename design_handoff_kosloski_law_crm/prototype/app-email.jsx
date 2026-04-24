// app-email.jsx — Firm Email (Gmail integration surface).
//
// Three-pane layout: Mailboxes column · Thread list · Reader.
// Key novel moves for a law firm CRM:
//   • Every email shows its Matter chip; Unfiled = needs tagging.
//   • One-click "File to matter…" with auto-suggest.
//   • "This firm" inbox aggregates all users' tagged emails by matter.
//   • Privileged/opposing-counsel flags; external-recipient warnings.
//   • Rules engine routes by sender/domain/subject to matters + tags.

// ── Mock data ───────────────────────────────────────────────────────────────
const EMAIL_USERS = [
  { id: 'jm', name: 'Jane Marsh',     email: 'jane@kosloskilaw.com',   role: 'Partner',      unread: 7, color: '#efe3d9' },
  { id: 'lk', name: 'Luis Kosloski',  email: 'luis@kosloskilaw.com',   role: 'Managing',     unread: 3, color: '#e3ebf5' },
  { id: 'rk', name: 'Rosa Kim',       email: 'rosa@kosloskilaw.com',   role: 'Paralegal',    unread: 12, color: '#e6ecdc' },
  { id: 'mg', name: 'Marco Guerrero', email: 'marco@kosloskilaw.com',  role: 'Investigator', unread: 1, color: '#ecdfe0' },
  { id: 'sd', name: 'Sam Doan',       email: 'sam@kosloskilaw.com',    role: 'Intake',       unread: 4, color: '#e2dfec' },
];

// Full threaded message chains — each `messages` is newest-last.
// The reader collapses older messages into single-line summaries and
// displays the most-recent message fully expanded.
const EMAIL_THREADS = [
  {
    id: 't1', matter: 'alvarez', matterName: 'Alvarez v. Aurora PD',
    subject: 'RE: CGIA Notice of Claim — City of Aurora',
    from: 'Ruben Alvarado', fromEmail: 'ralvarado@auroragov.org', fromDomain: 'auroragov.org',
    owner: 'jm', owners: ['jm', 'rk'], dir: 'in',
    at: '9:42a',
    snippet: 'Confirming receipt of your CGIA notice dated April 12. Our office has assigned claim number 26-AUR-00481 and will respond within the statutory 90 days…',
    unread: true, starred: true, labels: ['opposing-counsel', 'privileged'],
    messages: [
      {
        who: 'out', from: 'Jane Marsh', fromEmail: 'jane@kosloskilaw.com',
        to: 'cityattorney@auroragov.org', at: 'Apr 12 · 3:14p',
        body: [
          'To the Office of the City Attorney:',
          'Enclosed please find a formal Notice of Claim on behalf of our client, Maria Alvarez, pursuant to C.R.S. § 24-10-109, arising out of the events of January 17, 2026, at approximately 14:22, involving Aurora Police Department officers responding to a traffic stop at the intersection of Colfax Avenue and Peoria Street.',
          'The claim arises from injuries sustained by Ms. Alvarez during the course of that stop, which we contend constituted excessive force in violation of the Fourth and Fourteenth Amendments to the United States Constitution and 42 U.S.C. § 1983, as well as state-law claims preserved by this notice.',
          'We request that the City preserve all body-worn camera footage, dashboard camera footage, CAD logs, dispatch audio, use-of-force reports, and training records for the responding officers pending further proceedings.',
          'Please confirm receipt of this Notice at your earliest convenience.',
          'Regards,\nJane Marsh\nKosloski Law'
        ],
        attachments: [{ name: 'CGIA_Notice_Alvarez.pdf', size: '312 KB' }],
      },
      {
        who: 'in', from: 'Ruben Alvarado', fromEmail: 'ralvarado@auroragov.org',
        to: 'Jane Marsh', at: 'Apr 14 · 10:18a',
        body: [
          'Ms. Marsh,',
          'Acknowledging receipt of the Notice of Claim. It has been docketed as claim 26-AUR-00481 and routed to risk management for initial review.',
          'Given the scope of preservation requested, I will coordinate internally regarding BWC retention. Our retention policy for the footage in question is 90 days absent a hold, so your preservation demand is timely.',
          'Please direct all further correspondence to my attention.',
          'Ruben Alvarado\nDeputy City Attorney, Aurora'
        ],
      },
      {
        who: 'out', from: 'Jane Marsh', fromEmail: 'jane@kosloskilaw.com',
        to: 'Ruben Alvarado', at: 'Apr 14 · 2:41p',
        body: [
          'Ruben — thank you for the prompt acknowledgment and the confirmation regarding BWC retention. A few follow-up items:',
          '1. Please extend the preservation to include all four responding officers (Unit 4421 primary plus three cover units identified on the CAD log), two hours pre-incident through end of shift.\n2. Confirm that training and use-of-force certification records for the last 24 months are being preserved.\n3. I would appreciate a proposed schedule for initial disclosures once the 90-day window closes.',
          'I\'m happy to meet and confer on scope if useful.',
          'Best,\nJane'
        ],
      },
      {
        who: 'in', from: 'Ruben Alvarado', fromEmail: 'ralvarado@auroragov.org',
        to: 'Jane Marsh', at: '9:42a',
        body: [
          'Jane,',
          'Confirming receipt of your CGIA notice dated April 12. Our office has assigned claim number 26-AUR-00481 and will respond within the statutory 90 days.',
          'On your three follow-up items: (1) we will extend preservation as requested, though we reserve objections as to the scope of the "cover units" as currently defined; (2) training and certification records are preserved; (3) we anticipate being able to propose a disclosure schedule by the week of May 19.',
          'I note that my client considers portions of the attached position statement to be subject to the common-interest privilege with co-counsel for the individual officers, and we are treating our communications accordingly. Please do not forward externally absent further discussion.',
          'I\'ve attached our preliminary position statement for your review.',
          'Regards,\nRuben Alvarado\nDeputy City Attorney, Aurora'
        ],
        attachments: [{ name: 'Aurora_Position_Statement.pdf', size: '284 KB' }],
      },
    ],
  },
  {
    id: 't2', matter: 'alvarez', matterName: 'Alvarez v. Aurora PD',
    subject: 'Records subpoena — Aurora PD body-cam BWC-4421',
    from: 'Rosa Kim', fromEmail: 'rosa@kosloskilaw.com', fromDomain: 'kosloskilaw.com',
    owner: 'rk', owners: ['rk', 'jm'], dir: 'out',
    at: '8:55a',
    snippet: 'Draft subpoena attached for your review. I\'ve narrowed the request to incident window 14:00–15:30 plus 2hr buffer per our Rule 26(b) scoping discussion…',
    unread: false, starred: false, labels: ['internal'],
    messages: [
      {
        who: 'out', from: 'Jane Marsh', fromEmail: 'jane@kosloskilaw.com',
        to: 'Rosa Kim', at: 'Yesterday · 4:06p',
        body: [
          'Rosa — please take a pass at the records subpoena for the BWC footage. Narrow it to the stop window plus a reasonable buffer per our Rule 26(b) discussion; we don\'t want to invite a motion to quash over scope.',
          'Thanks,\nJane'
        ],
      },
      {
        who: 'out', from: 'Rosa Kim', fromEmail: 'rosa@kosloskilaw.com',
        to: 'Jane Marsh', at: '8:55a',
        body: [
          'Jane —',
          'Draft subpoena attached for your review. I\'ve narrowed the request to incident window 14:00–15:30 plus 2hr buffer per our Rule 26(b) scoping discussion, and limited the BWC request to the four responding officers identified on the CAD log.',
          'Two things I\'d flag:',
          '• The custodian of records for APD now requires subpoenas to be served via their online portal — I\'ve pre-filled the form and saved a PDF of the submission payload for the file.\n• We should decide whether to include the CAD audio as part of this request or break it out separately.',
          'Proposed return date is 30 days out, which lines up with the state\'s disclosure schedule. Let me know if you want changes before I finalize.',
          '— Rosa'
        ],
        attachments: [
          { name: 'Subpoena_Alvarez_BWC_draft.docx', size: '42 KB' },
          { name: 'APD_portal_payload.pdf', size: '88 KB' },
        ],
      },
    ],
  },
  {
    id: 't3', matter: 'williams', matterName: 'Williams v. Denver',
    subject: 'Re: Rule 26 disclosures — witness list discrepancy',
    from: 'Patricia Chen', fromEmail: 'pchen@denverlaw.org', fromDomain: 'denverlaw.org',
    owner: 'jm', owners: ['jm'], dir: 'in',
    at: 'Yesterday',
    snippet: 'Jane — per our call, attaching our amended witness list. Note the late addition of Officer Holden, whose BWC footage we produced last week…',
    unread: true, starred: false, labels: ['opposing-counsel'],
    messages: [
      {
        who: 'out', from: 'Jane Marsh', fromEmail: 'jane@kosloskilaw.com',
        to: 'Patricia Chen', at: 'Apr 20 · 11:02a',
        body: [
          'Patricia — following up on our Rule 26 disclosures. The witness list you produced on April 10 does not appear to include Officer Holden, whose body-cam footage you produced to us last week.',
          'Can you confirm whether Officer Holden is being withheld as a witness or whether this was an oversight?',
          'Jane'
        ],
      },
      {
        who: 'in', from: 'Patricia Chen', fromEmail: 'pchen@denverlaw.org',
        to: 'Jane Marsh', at: 'Yesterday · 2:34p',
        body: [
          'Jane — per our call, attaching our amended witness list. Note the late addition of Officer Holden, whose BWC footage we produced last week. His role was limited to arrival on-scene after the initial encounter, but we want to preserve the option to call him if needed.',
          'We\'re also adding Sergeant Ramirez in a supervisory capacity — relevant to the claims regarding the department\'s use-of-force policy and supervision.',
          'Let me know if a supplemental deposition of either officer would resolve your concerns; we\'re prepared to offer dates in early June.',
          'Patricia Chen\nDenver City Attorney\'s Office'
        ],
        attachments: [{ name: 'Williams_amended_witness_list.pdf', size: '96 KB' }],
      },
    ],
  },
  {
    id: 't4', matter: null, matterName: null,
    subject: 'Potential client inquiry — housing discrimination',
    from: 'Angela Patel', fromEmail: 'apatel@gmail.com', fromDomain: 'gmail.com',
    owner: 'sd', owners: ['sd'], dir: 'in',
    at: 'Yesterday',
    snippet: 'Hello, I was referred by CCLA. My landlord in Arvada refused to renew my lease after I disclosed my disability and requested a reasonable accommodation…',
    unread: true, starred: false, labels: [],
    suggest: { matter: 'Patel intake (new)', confidence: 0.72, reason: 'FHA keywords + CCLA referral domain + intake queue match' },
    messages: [
      {
        who: 'in', from: 'Angela Patel', fromEmail: 'apatel@gmail.com',
        to: 'intake@kosloskilaw.com', at: 'Yesterday · 6:48p',
        body: [
          'Hello,',
          'I was referred to your firm by the Colorado Civil Liberties Alliance. My landlord in Arvada refused to renew my lease after I disclosed my disability (I use a wheelchair) and requested a reasonable accommodation — specifically, permission to install a temporary, removable ramp at the front entrance, at my own expense.',
          'The accommodation request was submitted in writing on February 4. On March 12, I received a notice of non-renewal citing "other business reasons." I have a disability verification letter from my physician, all of my correspondence with the landlord, and copies of the lease and the non-renewal notice.',
          'My current lease ends June 30. I am not sure whether this is a case your firm would consider, but I would very much appreciate a consultation.',
          'Thank you,\nAngela Patel\n(303) 555-0194'
        ],
      },
    ],
  },
  {
    id: 't5', matter: 'rivera', matterName: 'Rivera v. Lakewood',
    subject: 'Settlement funds received — wire confirmation',
    from: 'First Western Trust', fromEmail: 'trust-ops@fwtrust.com', fromDomain: 'fwtrust.com',
    owner: 'lk', owners: ['lk', 'jm'], dir: 'in',
    at: 'Apr 21',
    snippet: 'Confirming receipt of settlement wire in the amount of $432,000.00 to IOLTA 9821-4455 on April 21, 2026 at 14:22 MDT. Reference: RIVERA-LAKEWOOD-01…',
    unread: false, starred: true, labels: ['trust-funds', 'auto-filed'],
    messages: [
      {
        who: 'in', from: 'First Western Trust · Trust Ops', fromEmail: 'trust-ops@fwtrust.com',
        to: 'Luis Kosloski', at: 'Apr 21 · 2:28p',
        body: [
          'Dear Mr. Kosloski,',
          'This email confirms receipt of an incoming wire transfer to your firm\'s IOLTA on the following terms:',
          'Amount:       $432,000.00\nAccount:      IOLTA 9821-4455 (Kosloski Law LLC)\nPosted:       April 21, 2026 · 14:22 MDT\nOriginator:   City of Lakewood Risk Mgmt\nReference:    RIVERA-LAKEWOOD-01 settlement, per stipulation filed 4/18',
          'The funds are available. A signed wire-receipt statement is attached for your records and is also available in the IOLTA dashboard.',
          'Please reply directly if the posted amount or reference does not match your records.',
          'First Western Trust · Trust Operations'
        ],
        attachments: [{ name: 'Wire_receipt_RIVERA_20260421.pdf', size: '64 KB' }],
      },
    ],
  },
  {
    id: 't6', matter: 'alvarez', matterName: 'Alvarez v. Aurora PD',
    subject: 'Photos from incident — Maria Alvarez',
    from: 'Maria Alvarez', fromEmail: 'm.alvarez.co@gmail.com', fromDomain: 'gmail.com',
    owner: 'rk', owners: ['rk'], dir: 'in',
    at: 'Apr 20',
    snippet: 'Rosa — here are the photos of my injuries taken at Medical of Aurora on Jan 18. My son also took video outside the scene. Let me know if you need more…',
    unread: false, starred: false, labels: ['client'],
    messages: [
      {
        who: 'out', from: 'Rosa Kim', fromEmail: 'rosa@kosloskilaw.com',
        to: 'Maria Alvarez', at: 'Apr 18 · 9:12a',
        body: [
          'Hi Maria — when you have a moment, could you send over any photos you have of your injuries and anything from the scene? Please send originals from your phone if possible (unedited).',
          'Thanks,\nRosa'
        ],
      },
      {
        who: 'in', from: 'Maria Alvarez', fromEmail: 'm.alvarez.co@gmail.com',
        to: 'Rosa Kim', at: 'Apr 20 · 7:54p',
        body: [
          'Rosa —',
          'Here are the photos of my injuries taken at Medical of Aurora on January 18 — the date of the ER visit. There are seven photos total: two of the bruising on my left arm and shoulder, one of the cut on my forehead, and four of my wrist from different angles.',
          'My son Diego also took a short video outside the scene, maybe a minute long, just before the officers put me in the back of the car. I\'ve attached that too.',
          'Please let me know if you need more or if I should go back to Medical of Aurora for copies of the discharge paperwork.',
          'Thank you,\nMaria'
        ],
        attachments: [
          { name: 'IMG_Medical_01.jpg', size: '2.1 MB' },
          { name: 'IMG_Medical_02.jpg', size: '1.8 MB' },
          { name: 'IMG_Medical_03.jpg', size: '2.4 MB' },
          { name: 'Video_scene_Diego.mov', size: '14.2 MB' },
        ],
      },
      {
        who: 'out', from: 'Rosa Kim', fromEmail: 'rosa@kosloskilaw.com',
        to: 'Maria Alvarez', at: 'Apr 20 · 8:11p',
        body: [
          'Maria — got everything, thank you. I\'ve filed them into our evidence folder for your case. Yes, please do go back and request the discharge paperwork if you can, and a signed release of records would let us pull the full file directly.',
          'I\'ll mail you the release form tomorrow.',
          'Rosa'
        ],
      },
    ],
  },
  {
    id: 't7', matter: null, matterName: null,
    subject: 'Vendor — Westlaw invoice March 2026',
    from: 'Thomson Reuters', fromEmail: 'billing@tr.com', fromDomain: 'tr.com',
    owner: 'jm', owners: ['jm'], dir: 'in',
    at: 'Apr 19',
    snippet: 'Invoice #WL-2026-03-8821 is ready. Total due: $1,240.00. Auto-pay scheduled for April 30…',
    unread: false, starred: false, labels: ['admin'],
    suggest: { matter: '— (admin, no matter)', confidence: 0.95, reason: 'Known vendor domain · admin expense rule' },
    messages: [
      {
        who: 'in', from: 'Thomson Reuters Billing', fromEmail: 'billing@tr.com',
        to: 'billing@kosloskilaw.com', at: 'Apr 19 · 6:03a',
        body: [
          'Your Westlaw invoice for March 2026 is ready.',
          'Invoice #:     WL-2026-03-8821\nPeriod:        March 1–31, 2026\nPlan:          Westlaw Edge · 3 seats\nSubtotal:      $1,200.00\nTax:           $40.00\nTotal due:     $1,240.00',
          'Auto-pay is scheduled for April 30, 2026, to the card on file. A detailed breakdown of usage by seat and by practice area is attached.',
          'Questions? Reply to this email or call 1-800-REF-ATTY.',
          'Thomson Reuters Billing'
        ],
        attachments: [{ name: 'Westlaw_Mar2026_invoice.pdf', size: '118 KB' }],
      },
    ],
  },
  {
    id: 't8', matter: 'aurora', matterName: 'In re: Aurora class',
    subject: 'Class certification — expert report draft',
    from: 'Dr. Lisa Ferreira', fromEmail: 'lferreira@cuboulder.edu', fromDomain: 'cuboulder.edu',
    owner: 'lk', owners: ['lk', 'jm', 'rk'], dir: 'in',
    at: 'Apr 18',
    snippet: 'Luis — attached is the second draft of the statistical analysis for the class certification motion. I\'ve added the 2019–2023 stop data per your request…',
    unread: false, starred: true, labels: ['expert', 'privileged'],
    messages: [
      {
        who: 'out', from: 'Luis Kosloski', fromEmail: 'luis@kosloskilaw.com',
        to: 'Dr. Lisa Ferreira', at: 'Apr 8 · 10:45a',
        body: [
          'Dr. Ferreira — thank you for the first draft. A few items before you circulate the second:',
          '(1) Please extend the time series back to 2019 so we can capture the pre-consent-decree baseline.\n(2) Disaggregate by precinct rather than by zone; opposing counsel will argue zone boundaries were drawn around the disparities.\n(3) Footnote the data source and any imputation you used for missing demographic fields.',
          'Our certification brief is due June 2, so any version you can share by May 10 would give us time to integrate.',
          'Best,\nLuis'
        ],
      },
      {
        who: 'in', from: 'Dr. Lisa Ferreira', fromEmail: 'lferreira@cuboulder.edu',
        to: 'Luis Kosloski', at: 'Apr 18 · 11:22a',
        body: [
          'Luis —',
          'Attached is the second draft of the statistical analysis for the class certification motion. I\'ve added the 2019–2023 stop data per your request, which materially strengthens the commonality and typicality showing — the pre- and post-decree distributions are now tested separately, and the disparity persists in both windows.',
          'Headline results, subject to the caveats in Section 4:',
          '• Stop rate for the proposed class is 3.4× the control rate across the full period (95% CI: 3.1–3.7).\n• The result is robust to precinct-level disaggregation (Section 5) and to five different specifications of the control population (Appendix B).\n• The 2019–2021 window (pre-decree) shows a 3.9× rate; the 2022–2023 window shows 3.1×, which is consistent with partial compliance with the consent-decree reforms but well outside any plausible null.',
          'Two caveats worth discussing before we finalize:',
          '1. The 2020 data has a known undercount due to the pandemic-era reporting gap; I\'ve handled this with multiple imputation and footnoted the approach in §4.2, but we should be ready for a Daubert challenge.\n2. I have not yet had access to the supplemental CAD logs you mentioned; if those become available in discovery they should be incorporated before the final report.',
          'Happy to discuss on a call. I\'m open most afternoons this week.',
          'Best,\nLisa\n\nLisa Ferreira, PhD\nProfessor, Statistics\nUniversity of Colorado Boulder'
        ],
        attachments: [
          { name: 'Ferreira_report_v2_DRAFT.pdf', size: '1.9 MB' },
          { name: 'Ferreira_appendix_methodology.pdf', size: '680 KB' },
        ],
      },
    ],
  },
];

// Thread helpers
const msgCount = (t) => (t.messages || []).length;
const latestMsg = (t) => (t.messages || [])[(t.messages || []).length - 1];

function userById(uid) { return EMAIL_USERS.find(u => u.id === uid) || EMAIL_USERS[0]; }

// ── Small helpers ───────────────────────────────────────────────────────────
const FilterPill = ({ on, children, onClick, count }) => (
  <div onClick={onClick}
       style={{
         display: 'inline-flex', alignItems: 'center', gap: 6,
         padding: '4px 10px', borderRadius: 999,
         background: on ? 'var(--blue-500)' : '#fff',
         border: `1px solid ${on ? 'var(--blue-500)' : MF.line}`,
         color: on ? '#fff' : MF.ink2,
         font: `500 11.5px ${MF.fUI}`,
         cursor: 'pointer', whiteSpace: 'nowrap',
       }}>
    {children}
    {count !== undefined && (
      <span style={{
        background: on ? 'rgba(255,255,255,.2)' : MF.bg2,
        color: on ? '#fff' : MF.ink3,
        borderRadius: 10, padding: '0 6px', fontSize: 10, fontFamily: MF.fMono,
      }}>{count}</span>
    )}
  </div>
);

function MailboxItem({ ic, label, count, on, onClick, color, shortcut, indent }) {
  return (
    <div onClick={onClick}
         style={{
           display: 'flex', alignItems: 'center', gap: 8,
           padding: '6px 10px 6px ' + (indent ? '22px' : '10px'),
           borderRadius: 6, cursor: 'pointer',
           background: on ? 'var(--blue-soft)' : 'transparent',
           color: on ? 'var(--blue-900)' : MF.ink,
           fontWeight: on ? 600 : 400,
           fontSize: 12.5,
         }}>
      {color && <span className="mf-dot" style={{ background: color }} />}
      {ic && <span style={{ width: 14, color: on ? 'var(--blue-500)' : MF.ink3, display: 'inline-flex' }}><Icon n={ic} size={14} /></span>}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {shortcut && <span className="mf-kbd" style={{ fontSize: 9, padding: '0 4px' }}>{shortcut}</span>}
      {count !== undefined && count !== null && (
        <span style={{
          fontSize: 10, fontFamily: MF.fMono,
          background: on ? 'var(--blue-500)' : MF.bg2,
          color: on ? '#fff' : MF.ink3,
          padding: '1px 6px', borderRadius: 8,
        }}>{count}</span>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
function PageEmail({ go }) {
  const [mailbox, setMailbox] = React.useState('firm'); // firm | unfiled | starred | sent | drafts | matter:<id>
  const [activeThreadId, setActiveThreadId] = React.useState('t1');
  const [filter, setFilter] = React.useState('all'); // all | unread | unfiled | attach
  const [query, setQuery] = React.useState('');
  const [composing, setComposing] = React.useState(null); // null | {matter, to, subject, preset}

  const openCompose = (init = {}) => setComposing({ to: '', subject: '', matter: null, body: '', ...init });
  React.useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); openCompose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtered = React.useMemo(() => {
    let rows = EMAIL_THREADS;
    // Default "Inbox" shows only current user (Jane)
    if (mailbox === 'firm') rows = rows.filter(t => t.owners.includes('jm'));
    else if (mailbox === 'unfiled') rows = rows.filter(t => !t.matter && t.owners.includes('jm'));
    else if (mailbox === 'starred') rows = rows.filter(t => t.starred && t.owners.includes('jm'));
    else if (mailbox === 'sent') rows = rows.filter(t => t.dir === 'out' && t.owners.includes('jm'));
    else if (mailbox === 'drafts') rows = [];
    else if (mailbox.startsWith('matter:')) {
      // Shared per-matter view — all users' tagged email
      rows = rows.filter(t => t.matter === mailbox.slice(7));
    }
    if (filter === 'unread') rows = rows.filter(t => t.unread);
    if (filter === 'unfiled') rows = rows.filter(t => !t.matter);
    if (filter === 'attach') rows = rows.filter(t => (t.messages || []).some(m => m.attachments && m.attachments.length));
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter(t =>
        t.subject.toLowerCase().includes(q) ||
        t.from.toLowerCase().includes(q) ||
        t.snippet.toLowerCase().includes(q) ||
        (t.matterName || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [mailbox, filter, query]);

  const active = filtered.find(t => t.id === activeThreadId) || filtered[0] || EMAIL_THREADS[0];

  return (
    <AppShell path="email" go={go} topbar={
      <AppTopBar
        crumbs={<span>FIRM · <span style={{ color: 'var(--blue-700)' }}>Gmail</span></span>}
        title="Email"
        sub={
          <div className="mf-row mf-g6 mf-ai" style={{ marginLeft: 8 }}>
            <Chip accent>jane@kosloskilaw.com</Chip>
            <span className="mf-ink3" style={{ fontSize: 11 }}>· synced 12s ago</span>
          </div>
        }
        right={<>
          <GlobalSearch />
          <Btn icon="bolt">Rules</Btn>
          <Btn primary icon="plus" onClick={() => openCompose()}>Compose</Btn>
        </>}
      />
    }>
      <div className="mf-row" style={{ flex: 1, minHeight: 0 }}>
        {/* ── pane 1: mailboxes ── */}
        <div className="mf-col" style={{
          width: 200, flexShrink: 0,
          borderRight: `1px solid ${MF.line}`, background: '#fbfafa',
          overflowY: 'auto',
        }}>
          <div style={{ padding: '10px 10px 6px' }}>
            <Btn primary icon="plus" style={{ width: '100%', justifyContent: 'center' }} onClick={() => openCompose()}>Compose</Btn>
          </div>

          <div className="mf-sec">My inboxes</div>
          <div style={{ padding: '0 6px' }}>
            <MailboxItem ic="inbox"   label="Inbox"          count={EMAIL_THREADS.filter(t => t.unread && t.owners.includes('jm')).length} on={mailbox === 'firm'} onClick={() => setMailbox('firm')} shortcut="1" />
            <MailboxItem ic="folder"  label="Unfiled"        count={EMAIL_THREADS.filter(t => !t.matter && t.owners.includes('jm')).length} on={mailbox === 'unfiled'} onClick={() => setMailbox('unfiled')} shortcut="2" />
            <MailboxItem ic="star"    label="Starred"        count={EMAIL_THREADS.filter(t => t.starred && t.owners.includes('jm')).length} on={mailbox === 'starred'} onClick={() => setMailbox('starred')} />
            <MailboxItem ic="send"    label="Sent"           count={EMAIL_THREADS.filter(t => t.dir === 'out' && t.owners.includes('jm')).length} on={mailbox === 'sent'} onClick={() => setMailbox('sent')} />
            <MailboxItem ic="file"    label="Drafts"         count={2} on={mailbox === 'drafts'} onClick={() => setMailbox('drafts')} />
          </div>

          <div className="mf-sec">By matter <span className="mf-ink4" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 10, marginLeft: 4 }}>(shared)</span></div>
          <div style={{ padding: '0 6px' }}>
            {[
              ['alvarez', 'Alvarez v. Aurora PD', '#3d83b8'],
              ['williams', 'Williams v. Denver', '#3d83b8'],
              ['aurora', 'In re: Aurora class', '#8a6a2d'],
              ['rivera', 'Rivera v. Lakewood', '#3d83b8'],
              ['patel', 'Patel (intake)', '#2d8a5f'],
            ].map(([id, name, color]) => (
              <MailboxItem key={id} label={name} color={color}
                           count={EMAIL_THREADS.filter(t => t.matter === id).length || null}
                           on={mailbox === 'matter:' + id}
                           onClick={() => setMailbox('matter:' + id)} />
            ))}
          </div>

          <div style={{ flex: 1 }} />
          <div style={{ padding: '10px 12px', borderTop: `1px solid ${MF.line}`, background: '#f3f1ea' }}>
            <div className="mf-ink3" style={{ fontSize: 10.5, fontFamily: MF.fMono, lineHeight: 1.6 }}>
              <div><span style={{ color: 'var(--blue-500)' }}>●</span> Gmail API · OAuth 2.0</div>
              <div>jane@kosloskilaw.com</div>
              <div><span style={{ color: MF.ok }}>●</span> 3,421 threads indexed</div>
              <div className="mf-link" onClick={() => go('settings')} style={{ marginTop: 4, fontFamily: MF.fUI }}>Manage integration →</div>
            </div>
          </div>
        </div>

        {/* ── pane 2: thread list ── */}
        <div className="mf-col" style={{ width: 360, flexShrink: 0, borderRight: `1px solid ${MF.line}`, background: '#fff' }}>
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${MF.line}` }}>
            <div className="mf-input" style={{ height: 30 }}>
              <Icon n="search" size={13} style={{ color: MF.ink3 }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search mail, subjects, senders, matters…"
                style={{ border: 'none', outline: 'none', flex: 1, background: 'transparent', font: 'inherit', color: MF.ink }}
              />
              {query && <span className="mf-mono mf-ink4" style={{ fontSize: 10 }}>{filtered.length}</span>}
            </div>
            <div className="mf-row mf-g6" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              <FilterPill on={filter === 'all'} onClick={() => setFilter('all')} count={EMAIL_THREADS.length}>All</FilterPill>
              <FilterPill on={filter === 'unread'} onClick={() => setFilter('unread')} count={EMAIL_THREADS.filter(t=>t.unread).length}>Unread</FilterPill>
              <FilterPill on={filter === 'unfiled'} onClick={() => setFilter('unfiled')} count={EMAIL_THREADS.filter(t=>!t.matter).length}>Unfiled</FilterPill>
              <FilterPill on={filter === 'attach'} onClick={() => setFilter('attach')} count={EMAIL_THREADS.filter(t => (t.messages||[]).some(m=>m.attachments&&m.attachments.length)).length}>Attach</FilterPill>
            </div>
          </div>

          <div className="mf-scroll" style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map(t => {
              const u = userById(t.owner);
              const on = t.id === active?.id;
              return (
                <div key={t.id}
                     onClick={() => setActiveThreadId(t.id)}
                     style={{
                       padding: '12px 14px 14px',
                       borderBottom: `1px solid ${MF.line}`,
                       background: on ? 'var(--blue-soft)' : t.unread ? '#fff' : '#fcfbf8',
                       borderLeft: on ? '3px solid var(--blue-500)' : '3px solid transparent',
                       cursor: 'pointer',
                     }}>
                  <div className="mf-row mf-g6 mf-ai" style={{ marginBottom: 4 }}>
                    <Av initials={u.name.split(' ').map(w => w[0]).join('').slice(0,2)} color={u.color} />
                    <span className="mf-mono mf-ink3" style={{ fontSize: 10 }}>{u.name.split(' ')[0]}</span>
                    {t.dir === 'out' && <Chip ghost style={{ fontSize: 9, padding: '0 5px' }}>sent</Chip>}
                    <span style={{ flex: 1 }} />
                    {t.starred && <Icon n="star" size={11} style={{ color: '#b88a2d' }} />}
                    <span className="mf-mono mf-ink4" style={{ fontSize: 10 }}>{t.at}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: t.unread ? 600 : 500, color: t.unread ? MF.ink : MF.ink2, marginBottom: 3 }}>
                    {t.from}{msgCount(t) > 1 && <span className="mf-ink3" style={{ fontWeight: 400 }}> ({msgCount(t)})</span>}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: t.unread ? 500 : 400, color: MF.ink2, marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.subject}
                  </div>
                  <div className="mf-ink3" style={{ fontSize: 11.5, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 8 }}>
                    {t.snippet}
                  </div>
                  <div className="mf-row mf-ai" style={{ gap: 5, flexWrap: 'wrap', rowGap: 5 }}>
                    {t.matter ? (
                      <span onClick={(e) => { e.stopPropagation(); go('matter/' + t.matter); }}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '2px 7px', borderRadius: 4,
                              background: 'var(--blue-500)', color: '#fff',
                              fontSize: 10, fontWeight: 600, fontFamily: MF.fMono,
                              cursor: 'pointer',
                              maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                        <Icon n="folder" size={10} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.matterName}</span>
                      </span>
                    ) : (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 7px', borderRadius: 4,
                        background: '#fbf0ea', color: '#b6623d', border: '1px dashed #e2c0ad',
                        fontSize: 10, fontWeight: 600, fontFamily: MF.fMono,
                      }}>
                        <Icon n="folder" size={10} /> unfiled
                      </span>
                    )}
                    {t.labels.map(l => (
                      <span key={l} style={{
                        fontSize: 9.5, padding: '2px 6px', borderRadius: 3, lineHeight: 1,
                        background: l === 'privileged' ? '#fdf4d5' : l === 'opposing-counsel' ? '#fbe5e0' : l === 'auto-filed' ? '#ecf6f1' : MF.bg2,
                        color: l === 'privileged' ? '#8a6a2d' : l === 'opposing-counsel' ? '#c13c3c' : l === 'auto-filed' ? MF.ok : MF.ink3,
                        fontFamily: MF.fMono, fontWeight: 500, whiteSpace: 'nowrap',
                      }}>{l}</span>
                    ))}
                    {(() => {
                      const n = (t.messages||[]).reduce((a,m)=>a+((m.attachments&&m.attachments.length)||0),0);
                      return n > 0 ? <span className="mf-mono mf-ink4" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>📎 {n}</span> : null;
                    })()}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="mf-center" style={{ padding: 40, color: MF.ink4, fontSize: 12 }}>No messages match this view.</div>
            )}
          </div>
        </div>

        {/* ── pane 3: reader ── */}
        {active && <ThreadReader t={active} go={go} openCompose={openCompose} />}
      </div>
      {composing && <ComposeWindow draft={composing} onClose={() => setComposing(null)} onUpdate={(patch) => setComposing(c => ({ ...c, ...patch }))} />}
    </AppShell>
  );
}

function ThreadReader({ t, go, openCompose }) {
  const owner = userById(t.owner);
  const msgs = t.messages || [];
  const lastIdx = msgs.length - 1;
  // Collapse older messages; expand the latest by default.
  const [expanded, setExpanded] = React.useState(() => new Set([lastIdx]));
  React.useEffect(() => { setExpanded(new Set([lastIdx])); }, [t.id, lastIdx]);
  const toggle = (i) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  const expandAll = () => setExpanded(new Set(msgs.map((_, i) => i)));
  const collapseAll = () => setExpanded(new Set([lastIdx]));

  // Context rail is a toggleable drawer — hidden by default so the email content dominates.
  const [showContext, setShowContext] = React.useState(false);
  const rootRef = React.useRef(null);
  return (
    <div ref={rootRef} className="mf-col mf-flex1" style={{ background: '#fff', minWidth: 0 }}>
      {/* reader topbar */}
      <div style={{ padding: '14px 20px 16px', borderBottom: `1px solid ${MF.line}` }}>
        <div className="mf-between mf-ai" style={{ marginBottom: 10, gap: 10 }}>
          <div className="mf-row mf-g6 mf-ai" style={{ flexWrap: 'wrap' }}>
            {t.matter ? (
              <span onClick={() => go('matter/' + t.matter)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 9px', borderRadius: 5,
                      background: 'var(--blue-500)', color: '#fff',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}>
                <Icon n="folder" size={12} />
                <span className="mf-ink4" style={{ color: 'rgba(255,255,255,.7)', fontWeight: 500 }}>Filed ·</span>
                {t.matterName}
              </span>
            ) : (
              <div className="mf-row mf-g6 mf-ai" style={{
                padding: '4px 10px', borderRadius: 6,
                background: '#fbf0ea', border: '1px dashed #e2c0ad', color: '#b6623d',
              }}>
                <Icon n="warn" size={12} />
                <span style={{ fontSize: 11, fontWeight: 600 }}>Unfiled — pick a matter</span>
                {t.suggest && (
                  <>
                    <span className="mf-ink3" style={{ fontSize: 10 }}>· suggested:</span>
                    <Btn sm accent icon="plus">File to {t.suggest.matter} ({Math.round(t.suggest.confidence*100)}%)</Btn>
                    <Btn sm>Skip</Btn>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="mf-row mf-g4">
            <Btn sm icon="archive">Archive</Btn>
            <Btn sm icon="folder">{t.matter ? 'Refile' : 'File'}</Btn>
            <Btn sm icon="tag">Labels</Btn>
            <Btn sm onClick={() => expanded.size === msgs.length ? collapseAll() : expandAll()}>
              {expanded.size === msgs.length ? 'Collapse all' : 'Expand all'}
            </Btn>
            <Btn sm icon="info" onClick={() => setShowContext(s => !s)}>{showContext ? 'Hide details' : 'Details'}</Btn>
            <Btn sm icon="more"></Btn>
          </div>
        </div>
        <div className="mf-disp" style={{ fontSize: 22, color: '#0f1b2e', letterSpacing: '-.01em', lineHeight: 1.25, marginTop: 4 }}>{t.subject}</div>
        <div className="mf-row mf-ai" style={{ marginTop: 10, gap: 5, flexWrap: 'wrap', rowGap: 5 }}>
          {t.labels.map(l => (
            <Chip key={l} style={{
              fontSize: 10,
              background: l === 'privileged' ? '#fdf4d5' : l === 'opposing-counsel' ? '#fbe5e0' : l === 'auto-filed' ? '#ecf6f1' : '#fff',
              color: l === 'privileged' ? '#8a6a2d' : l === 'opposing-counsel' ? '#c13c3c' : l === 'auto-filed' ? MF.ok : MF.ink3,
              borderColor: l === 'privileged' ? '#e8d488' : l === 'opposing-counsel' ? '#e2c0ad' : MF.line,
            }}>{l}</Chip>
          ))}
        </div>
      </div>

      <div className="mf-row" style={{ flex: 1, minHeight: 0 }}>
        {/* message column — dominant */}
        <div className="mf-col mf-flex1 mf-scroll" style={{ overflowY: 'auto', padding: '18px 28px 80px', minWidth: 0, background: '#faf8f3' }}>
          <div style={{ maxWidth: 780, margin: '0 auto', width: '100%' }}>

            {/* privileged banner */}
            {t.labels.includes('opposing-counsel') && (
              <div style={{
                background: '#fdf0ee', border: '1px solid #e2c0ad', borderRadius: 6,
                padding: '8px 12px', marginBottom: 14, fontSize: 11.5, color: '#8a3a2a',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Icon n="warn" size={14} />
                <span><b>Opposing counsel.</b> Do not forward externally. Privilege review auto-applied.</span>
              </div>
            )}

            {msgs.map((m, i) => {
              const isLast = i === lastIdx;
              const isOpen = expanded.has(i);
              const isOutbound = m.who === 'out';
              const senderName = m.from;
              const senderInit = senderName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
              const senderColor = isOutbound ? (userById(t.owner).color) : '#ecdfe0';
              const firstLine = (m.body && m.body[0]) || '';

              if (!isOpen) {
                return (
                  <div key={i}
                       onClick={() => toggle(i)}
                       style={{
                         display: 'flex', alignItems: 'center', gap: 10,
                         padding: '10px 14px', marginBottom: 6,
                         background: '#fff', border: `1px solid ${MF.line}`, borderRadius: 8,
                         cursor: 'pointer',
                       }}
                       onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--blue-300)'}
                       onMouseLeave={e => e.currentTarget.style.borderColor = MF.line}>
                    <Av initials={senderInit} color={senderColor} />
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: MF.ink, flexShrink: 0 }}>{senderName}</span>
                    <span className="mf-ink3" style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {firstLine}
                    </span>
                    <span className="mf-mono mf-ink4" style={{ fontSize: 10.5, flexShrink: 0 }}>{m.at}</span>
                  </div>
                );
              }

              return (
                <div key={i} style={{
                  border: `1px solid ${isLast ? 'var(--blue-200)' : MF.line}`,
                  borderLeft: isLast ? '3px solid var(--blue-500)' : `1px solid ${MF.line}`,
                  borderRadius: 8, background: '#fff',
                  marginBottom: 10, overflow: 'hidden',
                  boxShadow: isLast ? '0 1px 0 rgba(12,36,67,.04)' : 'none',
                }}>
                  <div className="mf-between mf-ai"
                       onClick={() => !isLast && toggle(i)}
                       style={{
                         padding: '10px 14px',
                         background: isLast ? 'var(--blue-tint)' : '#fcfbf8',
                         borderBottom: `1px solid ${MF.line}`,
                         cursor: isLast ? 'default' : 'pointer',
                       }}>
                    <div className="mf-row mf-g10 mf-ai" style={{ minWidth: 0 }}>
                      <Av initials={senderInit} color={senderColor} lg />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {senderName}
                          <span className="mf-ink3" style={{ fontWeight: 400, fontSize: 11.5, marginLeft: 8 }}>
                            &lt;{m.fromEmail}&gt;
                          </span>
                        </div>
                        <div className="mf-ink3" style={{ fontSize: 11, marginTop: 1 }}>
                          to <span style={{ color: MF.ink2 }}>{m.to}</span> · {m.at}
                          {t.labels.includes('privileged') && <> · <span style={{ color: '#8a6a2d', fontWeight: 600 }}>privileged</span></>}
                        </div>
                      </div>
                    </div>
                    <div className="mf-row mf-g4">
                      {isLast && <Btn sm icon="reply" onClick={() => openCompose && openCompose({ to: m.fromEmail, subject: t.subject.startsWith('RE:') ? t.subject : 'RE: ' + t.subject, matter: t.matter, matterName: t.matterName, replyTo: t })}>Reply</Btn>}
                      <Btn sm icon="more"></Btn>
                    </div>
                  </div>
                  <div style={{
                    padding: '16px 20px 18px',
                    fontSize: 13.5, lineHeight: 1.62,
                    color: MF.ink,
                    fontFamily: '"Fraunces", Georgia, serif',
                  }}>
                    {(m.body || []).map((para, bi) => (
                      <p key={bi} style={{
                        margin: bi === 0 ? '0 0 10px' : '0 0 10px',
                        whiteSpace: 'pre-wrap',
                      }}>{para}</p>
                    ))}
                    {m.attachments && m.attachments.length > 0 && (
                      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px dashed ${MF.line}` }}>
                        <div className="mf-ink4" style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8, fontFamily: MF.fUI }}>
                          {m.attachments.length} attachment{m.attachments.length > 1 ? 's' : ''}
                        </div>
                        <div className="mf-row mf-g6" style={{ flexWrap: 'wrap' }}>
                          {m.attachments.map((a, ai) => {
                            const ext = (a.name.split('.').pop() || '').toUpperCase();
                            return (
                              <div key={ai} className="mf-row mf-g8 mf-ai" style={{
                                padding: '8px 12px', border: `1px solid ${MF.line}`, borderRadius: 6,
                                background: '#fcfbf8', fontFamily: MF.fUI, fontSize: 11.5, cursor: 'pointer',
                                minWidth: 200,
                              }}>
                                <div style={{
                                  width: 28, height: 32,
                                  background: ext === 'PDF' ? '#f8e1dc' : ext === 'DOCX' || ext === 'DOC' ? 'var(--blue-100)' : ext === 'JPG' || ext === 'PNG' ? '#e6ecdc' : ext === 'MOV' || ext === 'MP4' ? '#ecdfe0' : MF.bg2,
                                  color: ext === 'PDF' ? '#b6623d' : ext === 'DOCX' || ext === 'DOC' ? 'var(--blue-700)' : ext === 'JPG' || ext === 'PNG' ? '#5d7a3d' : ext === 'MOV' || ext === 'MP4' ? '#9a3c3c' : MF.ink3,
                                  borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontFamily: MF.fMono, fontSize: 9, fontWeight: 700,
                                }}>{ext.slice(0, 4)}</div>
                                <div>
                                  <div style={{ fontWeight: 500, color: MF.ink }}>{a.name}</div>
                                  <div className="mf-ink3" style={{ fontSize: 10, fontFamily: MF.fMono }}>{a.size} · save to Evidence ↓</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Reply composer stub */}
            <div onClick={() => openCompose && openCompose({ to: t.fromEmail, subject: t.subject.startsWith('RE:') ? t.subject : 'RE: ' + t.subject, matter: t.matter, matterName: t.matterName, replyTo: t })}
                 style={{
                   border: `1px dashed ${MF.line}`, borderRadius: 8,
                   padding: '14px 16px', background: '#fff', marginTop: 10,
                   cursor: 'pointer',
                 }}
                 onMouseEnter={e => { e.currentTarget.style.background = 'var(--blue-tint)'; e.currentTarget.style.borderColor = 'var(--blue-300)'; }}
                 onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = MF.line; }}>
              <div className="mf-row mf-g8 mf-ai" style={{ marginBottom: 8, flexWrap: 'wrap', rowGap: 6 }}>
                <Av initials="JM" color="#efe3d9" />
                <span className="mf-ink3" style={{ fontSize: 12 }}>Reply as jane@kosloskilaw.com</span>
                <span style={{ flex: 1, minWidth: 8 }} />
                <Btn sm onClick={(e) => { e.stopPropagation(); openCompose && openCompose({ to: t.fromEmail, subject: 'RE: ' + t.subject, matter: t.matter, matterName: t.matterName, replyTo: t }); }}>Reply</Btn>
                <Btn sm onClick={(e) => { e.stopPropagation(); openCompose && openCompose({ to: t.fromEmail, cc: 'rosa@kosloskilaw.com', subject: 'RE: ' + t.subject, matter: t.matter, matterName: t.matterName, replyTo: t }); }}>Reply all</Btn>
                <Btn sm onClick={(e) => { e.stopPropagation(); openCompose && openCompose({ to: '', subject: 'FWD: ' + t.subject, matter: t.matter, matterName: t.matterName, replyTo: t }); }}>Forward</Btn>
              </div>
              <div className="mf-ink4" style={{ fontSize: 11, fontStyle: 'italic' }}>Click to compose — responses auto-sync to Gmail Sent{t.matter ? ` and file to ${t.matterName}` : ''}.</div>
            </div>
          </div>
        </div>

        {/* right rail — details drawer (off by default) */}
        {showContext && <div className="mf-col" style={{
          width: 280, flexShrink: 0, borderLeft: `1px solid ${MF.line}`, background: '#fbfafa',
          overflowY: 'auto',
        }}>
          <div className="mf-between mf-ai" style={{ padding: '12px 14px 6px' }}>
            <div className="mf-sec" style={{ padding: 0 }}>Thread details</div>
            <button onClick={() => setShowContext(false)}
                    style={{ background: 'none', border: 'none', color: MF.ink3, cursor: 'pointer', padding: 4, fontSize: 14 }}
                    title="Close">×</button>
          </div>
          <div style={{ padding: '0 14px 14px' }}>
            <div className="mf-col mf-g8">
              <Ctx label="Participants" v={
                <div className="mf-row mf-g4 mf-ai" style={{ flexWrap: 'wrap' }}>
                  {t.owners.map(uid => {
                    const u = userById(uid);
                    return <Av key={uid} initials={u.name.split(' ').map(w=>w[0]).join('').slice(0,2)} color={u.color} />;
                  })}
                  <Av initials={t.from.split(' ').map(w=>w[0]).join('').slice(0,2)} color="#ecdfe0" />
                  <span className="mf-ink3" style={{ fontSize: 11 }}>+ {t.from}</span>
                </div>
              } />
              <Ctx label="Domain" v={<span className="mf-mono" style={{ fontSize: 11 }}>{t.fromDomain}</span>} />
              <Ctx label="Direction" v={t.dir === 'in' ? 'Inbound' : 'Outbound'} />
              <Ctx label="Messages" v={`${msgs.length} in thread`} />
            </div>
          </div>

          {t.matter && (
            <>
              <div className="mf-hbar" style={{ margin: '4px 14px' }} />
              <div style={{ padding: '10px 14px 14px' }}>
                <div className="mf-sec" style={{ padding: 0, marginBottom: 6 }}>Matter</div>
                <div onClick={() => go('matter/' + t.matter)} className="mf-card" style={{ padding: 10, cursor: 'pointer' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>{t.matterName}</div>
                  <div className="mf-ink3" style={{ fontSize: 11 }}>§1983 · Discovery · JM lead</div>
                  <div className="mf-row mf-g4" style={{ marginTop: 6 }}>
                    <Chip accent style={{ fontSize: 10 }}>12 tagged emails</Chip>
                    <Chip style={{ fontSize: 10 }}>4 participants</Chip>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="mf-hbar" style={{ margin: '0 14px' }} />
          <div style={{ padding: 14 }}>
            <div className="mf-sec" style={{ padding: 0, marginBottom: 6 }}>Actions</div>
            <div className="mf-col mf-g4">
              <ActionRow ic="clock"   label="Log time · 0.3h" sub="Auto-suggested from read + reply" />
              <ActionRow ic="file"    label="Save attachments to Evidence" sub="Files detected in thread" />
              <ActionRow ic="cal"     label="Add deadline from email" sub="Detected: 'within 30 days' → May 22" />
              <ActionRow ic="user"    label="Add sender to parties" sub={t.from + ' · ' + t.fromDomain} />
              <ActionRow ic="tag"     label="Apply privilege label" sub="Auto-applied · review" />
            </div>
          </div>

          <div className="mf-hbar" style={{ margin: '0 14px' }} />
          <div style={{ padding: 14 }}>
            <div className="mf-sec" style={{ padding: 0, marginBottom: 6 }}>Gmail sync</div>
            <div className="mf-ink3 mf-mono" style={{ fontSize: 10.5, lineHeight: 1.7 }}>
              <div>Message ID <span style={{ color: MF.ink }}>18f12a…b4c9</span></div>
              <div>Labels <span style={{ color: MF.ink }}>Kosloski/{t.matterName || 'Unfiled'}{t.labels.includes('privileged') ? ', Privileged' : ''}</span></div>
              <div>Thread <span style={{ color: MF.ink }}>{msgs.length} msgs · {t.owners.length + 1} participants</span></div>
              <div>Last sync <span style={{ color: 'var(--blue-700)' }}>12s ago</span></div>
            </div>
          </div>
        </div>}
      </div>
    </div>
  );
}

function Ctx({ label, v }) {
  return (
    <div>
      <div className="mf-ink4" style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12, color: MF.ink }}>{v}</div>
    </div>
  );
}

function ActionRow({ ic, label, sub }) {
  return (
    <div className="mf-row mf-g8 mf-ai" style={{
      padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
    }} onMouseEnter={e => e.currentTarget.style.background = 'var(--blue-tint)'}
       onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <span style={{
        width: 24, height: 24, borderRadius: 6,
        background: 'var(--blue-50)', color: 'var(--blue-600)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}><Icon n={ic} size={12} /></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{label}</div>
        <div className="mf-ink3" style={{ fontSize: 10.5, lineHeight: 1.3 }}>{sub}</div>
      </div>
    </div>
  );
}

// ── MATTER → EMAILS TAB ─────────────────────────────────────────────────────
function MatterEmails({ matterId = 'alvarez', go }) {
  const threads = EMAIL_THREADS.filter(t => t.matter === matterId);
  const [active, setActive] = React.useState(threads[0]?.id);
  const byUser = {};
  threads.forEach(t => { t.owners.forEach(uid => { byUser[uid] = (byUser[uid] || 0) + 1; }); });

  return (
    <div className="mf-p16 mf-col mf-g12" style={{ padding: 20 }}>
      {/* Summary strip */}
      <div className="mf-row mf-g10" style={{ flexWrap: 'wrap' }}>
        <div className="mf-card mf-p12" style={{ flex: 1, minWidth: 200 }}>
          <div className="mf-ink4" style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase' }}>Emails on file</div>
          <div className="mf-disp" style={{ fontSize: 26, color: '#0f1b2e', marginTop: 4 }}>{threads.length} <span className="mf-ink3" style={{ fontSize: 12 }}>threads · {threads.reduce((a,b)=>a+msgCount(b),0)} messages</span></div>
        </div>
        <div className="mf-card mf-p12" style={{ flex: 1, minWidth: 200 }}>
          <div className="mf-ink4" style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase' }}>Contributors</div>
          <div className="mf-row mf-g4" style={{ marginTop: 6 }}>
            {Object.entries(byUser).map(([uid, n]) => {
              const u = userById(uid);
              return (
                <div key={uid} className="mf-row mf-g4 mf-ai" style={{ padding: '3px 8px 3px 3px', border: `1px solid ${MF.line}`, borderRadius: 999, background: '#fff' }}>
                  <Av initials={u.name.split(' ').map(w=>w[0]).join('').slice(0,2)} color={u.color} />
                  <span style={{ fontSize: 11 }}>{u.name.split(' ')[0]} <span className="mf-mono mf-ink3">{n}</span></span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mf-card mf-p12" style={{ flex: 1, minWidth: 200 }}>
          <div className="mf-ink4" style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase' }}>Latest</div>
          <div style={{ fontSize: 12.5, marginTop: 4, fontWeight: 500 }}>{threads[0]?.from}</div>
          <div className="mf-ink3" style={{ fontSize: 11 }}>{threads[0]?.at} · {threads[0]?.subject.slice(0, 40)}…</div>
        </div>
        <div style={{ alignSelf: 'center' }}>
          <Btn primary icon="plus">Compose</Btn>
        </div>
      </div>

      <div className="mf-row mf-g12" style={{ alignItems: 'stretch' }}>
        {/* List */}
        <div className="mf-card mf-col" style={{ width: 380, flexShrink: 0 }}>
          <div className="mf-between mf-p10 mf-hl">
            <div style={{ fontWeight: 600, fontSize: 12 }}>All tagged email</div>
            <Seg options={['All', 'Client', 'Opp.', 'Expert', 'Internal']} value="All" />
          </div>
          <div className="mf-scroll" style={{ overflowY: 'auto', maxHeight: 520 }}>
            {threads.map(t => {
              const u = userById(t.owner);
              const on = t.id === active;
              return (
                <div key={t.id} onClick={() => setActive(t.id)} style={{
                  padding: '10px 12px', borderBottom: `1px solid ${MF.line}`,
                  background: on ? 'var(--blue-soft)' : 'transparent',
                  borderLeft: on ? '3px solid var(--blue-500)' : '3px solid transparent',
                  cursor: 'pointer',
                }}>
                  <div className="mf-row mf-g6 mf-ai" style={{ marginBottom: 2 }}>
                    <Av initials={u.name.split(' ').map(w=>w[0]).join('').slice(0,2)} color={u.color} />
                    <span className="mf-mono mf-ink3" style={{ fontSize: 10 }}>via {u.name.split(' ')[0]}</span>
                    <span style={{ flex: 1 }} />
                    <span className="mf-mono mf-ink4" style={{ fontSize: 10 }}>{t.at}</span>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: MF.ink, marginBottom: 2 }}>{t.from}</div>
                  <div style={{ fontSize: 12, color: MF.ink2, marginBottom: 4 }}>{t.subject}</div>
                  <div className="mf-ink3" style={{ fontSize: 11, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.snippet}</div>
                  <div className="mf-row mf-g4 mf-ai" style={{ marginTop: 5 }}>
                    {t.labels.slice(0, 2).map(l => (
                      <span key={l} style={{ fontSize: 9, padding: '0 5px', borderRadius: 3, background: MF.bg2, color: MF.ink3, fontFamily: MF.fMono, fontWeight: 500 }}>{l}</span>
                    ))}
                    {(() => {
                      const n = (t.messages||[]).reduce((a,m)=>a+((m.attachments&&m.attachments.length)||0),0);
                      return n > 0 ? <span className="mf-mono mf-ink4" style={{ fontSize: 10 }}>📎 {n}</span> : null;
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Reader for selected */}
        <div className="mf-card mf-flex1 mf-col" style={{ minWidth: 0 }}>
          {(() => {
            const t = threads.find(x => x.id === active) || threads[0];
            if (!t) return <div className="mf-center" style={{ padding: 40, color: MF.ink3 }}>No tagged emails yet.</div>;
            const u = userById(t.owner);
            return (
              <>
                <div className="mf-p12 mf-hl">
                  <div className="mf-disp" style={{ fontSize: 18, color: '#0f1b2e' }}>{t.subject}</div>
                  <div className="mf-row mf-g6 mf-ai" style={{ marginTop: 4 }}>
                    <Av initials={t.from.split(' ').map(w=>w[0]).join('').slice(0,2)} color="#ecdfe0" />
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{t.from}</span>
                    <span className="mf-ink3" style={{ fontSize: 11 }}>&lt;{t.fromEmail}&gt;</span>
                    <span className="mf-ink3" style={{ fontSize: 11 }}>· via {u.name} · {t.at}</span>
                  </div>
                </div>
                <div className="mf-scroll mf-p16" style={{ overflowY: 'auto', maxHeight: 400, fontFamily: '"Fraunces", Georgia, serif', fontSize: 13.5, lineHeight: 1.6, color: MF.ink }}>
                  <p>{u.name.split(' ')[0]} —</p>
                  <p>{t.snippet}</p>
                  <p>See attached for full position statement and proposed scheduling. Please confirm receipt and let me know your availability for a meet-and-confer before the June status conference.</p>
                  <p>Best,<br/>{t.from}</p>
                </div>
                <div className="mf-p10 mf-hairline mf-between">
                  <Btn icon="reply">Open in Firm Email →</Btn>
                  <div className="mf-row mf-g4">
                    <Chip>tagged to this matter</Chip>
                    <Chip accent>{msgCount(t)} in thread</Chip>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ── COMPOSE WINDOW ──────────────────────────────────────────────────────────
const MATTER_OPTIONS = [
  { id: 'alvarez',  name: 'Alvarez v. Aurora PD',     area: '§1983',      dot: '#3d83b8' },
  { id: 'williams', name: 'Williams v. Denver',       area: '§1983',      dot: '#3d83b8' },
  { id: 'aurora',   name: 'In re: Aurora class',      area: 'Class',      dot: '#8a6a2d' },
  { id: 'rivera',   name: 'Rivera v. Lakewood',       area: '§1983',      dot: '#3d83b8' },
  { id: 'patel',    name: 'Patel intake',             area: 'FHA',        dot: '#2d8a5f' },
  { id: 'moreno',   name: 'Moreno v. State',          area: 'CADA',       dot: '#b6623d' },
];

const EMAIL_TEMPLATES = [
  { id: 'engage',   name: 'Engagement letter · §1983',    snippet: 'Dear [Client],\n\nThank you for choosing Kosloski Law to represent you in connection with your civil rights claim against [Defendant]. This letter confirms our engagement…' },
  { id: 'cgia',     name: 'CGIA Notice of Claim',         snippet: 'To Whom It May Concern,\n\nPursuant to C.R.S. § 24-10-109, please accept this Notice of Claim on behalf of [Client] regarding the incident of [Date]…' },
  { id: 'hold',     name: 'Litigation hold',              snippet: 'To [Recipient],\n\nThis letter serves as formal notice to preserve all documents, electronic records, BWC footage, CAD logs, dispatch records, and other evidence related to…' },
  { id: 'demand',   name: 'Demand letter',                snippet: 'Counsel,\n\nOn behalf of our client [Client], we write to set forth our demand for resolution of the above-referenced matter prior to litigation…' },
  { id: 'status',   name: 'Client status update',         snippet: 'Hi [Client],\n\nI wanted to send you a quick update on where things stand with your case. Since we last spoke…' },
];

function ComposeWindow({ draft, onClose, onUpdate }) {
  const [expanded, setExpanded] = React.useState(true);
  const [minimized, setMinimized] = React.useState(false);
  const [showCc, setShowCc] = React.useState(!!draft.cc);
  const [showBcc, setShowBcc] = React.useState(!!draft.bcc);
  const [matterPickerOpen, setMatterPickerOpen] = React.useState(false);
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [logTime, setLogTime] = React.useState(true);
  const [sentFlash, setSentFlash] = React.useState(false);

  const matter = MATTER_OPTIONS.find(m => m.id === draft.matter);
  const chosenMatter = draft.matterName || matter?.name;

  const wrapStyle = expanded ? {
    position: 'fixed', inset: '6% 8%', zIndex: 120,
    background: '#fff', borderRadius: 12,
    boxShadow: '0 30px 80px -20px rgba(12,36,67,.45), 0 10px 30px -10px rgba(0,0,0,.2)',
    border: '1px solid var(--blue-200)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  } : minimized ? {
    position: 'fixed', right: 16, bottom: 0, width: 360, zIndex: 120,
    background: '#fff', borderRadius: '10px 10px 0 0',
    boxShadow: '0 -8px 24px -10px rgba(0,0,0,.2)',
    border: '1px solid var(--blue-200)', borderBottom: 'none',
    overflow: 'hidden',
  } : {
    position: 'fixed', right: 16, bottom: 0, width: 560, height: 520, zIndex: 120,
    background: '#fff', borderRadius: '10px 10px 0 0',
    boxShadow: '0 -20px 60px -20px rgba(12,36,67,.35), 0 -4px 18px -8px rgba(0,0,0,.2)',
    border: '1px solid var(--blue-200)', borderBottom: 'none',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };

  const onSend = () => {
    setSentFlash(true);
    setTimeout(() => { setSentFlash(false); onClose(); }, 900);
  };

  // backdrop only in expanded mode
  return (
    <>
      {expanded && <div onClick={() => setExpanded(false)}
                        style={{ position: 'fixed', inset: 0, background: 'rgba(12,24,38,.35)', zIndex: 119, backdropFilter: 'blur(2px)' }} />}
      <div style={wrapStyle}>
        {/* Header */}
        <div style={{
          padding: '8px 14px', background: 'linear-gradient(180deg, var(--blue-500), var(--blue-600))',
          color: '#fff', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 12.5, fontWeight: 600, flexShrink: 0,
        }}>
          <Icon n="mail" size={13} />
          <span>{draft.replyTo ? 'Reply' : 'New message'}</span>
          {chosenMatter && (
            <span style={{
              background: 'rgba(255,255,255,.18)', padding: '2px 8px', borderRadius: 4,
              fontSize: 10.5, fontFamily: MF.fMono,
            }}>→ {chosenMatter}</span>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={() => { setExpanded(false); setMinimized(m => !m); }}
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 4, opacity: 0.85 }}
                  title="Minimize">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="12" width="10" height="1.5"/></svg>
          </button>
          <button onClick={() => setExpanded(e => !e)}
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 4, opacity: 0.85 }}
                  title={expanded ? "Collapse" : "Expand"}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              {expanded
                ? <path d="M10 6 L14 2 M14 2 L14 6 M14 2 L10 2 M6 10 L2 14 M2 14 L2 10 M2 14 L6 14" />
                : <path d="M6 2 L2 2 L2 6 M10 14 L14 14 L14 10" />}
            </svg>
          </button>
          <button onClick={onClose}
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 4, opacity: 0.85 }}
                  title="Discard">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4l8 8M12 4l-8 8"/></svg>
          </button>
        </div>

        {!minimized && (
          <>
            {/* Matter tag bar — the signature CRM-specific compose control */}
            <div style={{
              padding: '10px 14px',
              background: chosenMatter ? 'var(--blue-soft)' : '#fbf0ea',
              borderBottom: `1px solid ${chosenMatter ? 'var(--blue-200)' : '#e2c0ad'}`,
              display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
              position: 'relative',
            }}>
              <Icon n="folder" size={14} style={{ color: chosenMatter ? 'var(--blue-700)' : '#b6623d' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: chosenMatter ? 'var(--blue-700)' : '#8a3a2a', fontWeight: 600 }}>
                  {chosenMatter ? 'Filing to matter' : 'No matter selected · file before sending'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: chosenMatter ? '#0f1b2e' : '#8a3a2a', marginTop: 1 }}>
                  {chosenMatter || 'Choose a matter…'}
                </div>
              </div>
              <button onClick={() => setMatterPickerOpen(v => !v)}
                      style={{
                        background: '#fff', border: `1px solid ${chosenMatter ? 'var(--blue-300)' : '#e2c0ad'}`,
                        padding: '5px 10px', borderRadius: 5, cursor: 'pointer',
                        font: `500 11.5px ${MF.fUI}`, color: MF.ink,
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                <Icon n="folder" size={11} />
                {chosenMatter ? 'Change' : 'Select matter'}
                <svg width="9" height="6" viewBox="0 0 10 6" fill="currentColor"><path d="M0 0 L5 6 L10 0 Z"/></svg>
              </button>
              {chosenMatter && (
                <button onClick={() => onUpdate({ matter: null, matterName: null })}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: MF.ink3, padding: 4, fontSize: 14 }}
                        title="Clear">×</button>
              )}

              {/* Matter picker dropdown */}
              {matterPickerOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', right: 14, zIndex: 5,
                  width: 340, background: '#fff', border: '1px solid var(--blue-200)',
                  borderRadius: 8, boxShadow: '0 10px 30px -8px rgba(12,36,67,.3)',
                  padding: 8,
                }}>
                  <div className="mf-input" style={{ marginBottom: 6 }}>
                    <Icon n="search" size={12} style={{ color: MF.ink3 }} />
                    <input autoFocus placeholder="Search matters…" style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, font: 'inherit' }} />
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: MF.ink4, padding: '6px 8px 4px' }}>
                    Suggested
                  </div>
                  <div onClick={() => { onUpdate({ matter: 'alvarez', matterName: 'Alvarez v. Aurora PD' }); setMatterPickerOpen(false); }}
                       style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer', background: 'var(--blue-tint)', border: '1px solid var(--blue-200)', marginBottom: 6 }}>
                    <div className="mf-between mf-ai">
                      <div className="mf-row mf-g6 mf-ai">
                        <span className="mf-dot" style={{ background: '#3d83b8' }} />
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Alvarez v. Aurora PD</span>
                      </div>
                      <Chip accent style={{ fontSize: 10 }}>87% match</Chip>
                    </div>
                    <div className="mf-ink3" style={{ fontSize: 10.5, marginTop: 2 }}>recipient domain auroragov.org · subject keywords</div>
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: MF.ink4, padding: '6px 8px 4px' }}>
                    All matters
                  </div>
                  {MATTER_OPTIONS.map(m => (
                    <div key={m.id}
                         onClick={() => { onUpdate({ matter: m.id, matterName: m.name }); setMatterPickerOpen(false); }}
                         style={{ padding: '6px 10px', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                         onMouseEnter={e => e.currentTarget.style.background = 'var(--blue-tint)'}
                         onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <span className="mf-dot" style={{ background: m.dot }} />
                      <span style={{ flex: 1, fontSize: 12 }}>{m.name}</span>
                      <Chip style={{ fontSize: 9 }}>{m.area}</Chip>
                    </div>
                  ))}
                  <div className="mf-hbar" style={{ margin: '6px 0' }} />
                  <div style={{ padding: '6px 10px', fontSize: 11.5, color: MF.ink3, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <Icon n="plus" size={11} /> Create new intake · no matter yet
                  </div>
                </div>
              )}
            </div>

            {/* From / To / Cc / Bcc / Subject */}
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${MF.line}`, flexShrink: 0 }}>
              <ComposeRow label="From">
                <div className="mf-row mf-g6 mf-ai">
                  <Av initials="JM" color="#efe3d9" />
                  <span style={{ fontSize: 12.5 }}>Jane Marsh</span>
                  <span className="mf-ink3 mf-mono" style={{ fontSize: 11 }}>&lt;jane@kosloskilaw.com&gt;</span>
                </div>
              </ComposeRow>
              <ComposeRow label="To">
                <input value={draft.to} onChange={e => onUpdate({ to: e.target.value })}
                       placeholder="recipient@example.com"
                       style={composeInput} />
                <div className="mf-row mf-g6">
                  {!showCc && <a onClick={() => setShowCc(true)} className="mf-link" style={{ fontSize: 11 }}>Cc</a>}
                  {!showBcc && <a onClick={() => setShowBcc(true)} className="mf-link" style={{ fontSize: 11 }}>Bcc</a>}
                </div>
              </ComposeRow>
              {showCc && (
                <ComposeRow label="Cc">
                  <input defaultValue={draft.cc || ''} placeholder="cc@example.com" style={composeInput} />
                </ComposeRow>
              )}
              {showBcc && (
                <ComposeRow label="Bcc">
                  <input placeholder="bcc@example.com" style={composeInput} />
                </ComposeRow>
              )}
              <ComposeRow label="Subject">
                <input value={draft.subject} onChange={e => onUpdate({ subject: e.target.value })}
                       placeholder="Subject"
                       style={{ ...composeInput, fontWeight: 500 }} />
              </ComposeRow>
            </div>

            {/* Smart-detect banner for external recipients */}
            {draft.to && /@(?!kosloskilaw\.com)/i.test(draft.to) && (
              <div style={{
                padding: '7px 14px', background: '#fdf4d5', borderBottom: '1px solid #e8d488',
                fontSize: 11, color: '#6a5020', display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Icon n="warn" size={12} style={{ color: '#b88a2d' }} />
                <span><b>External recipient.</b> Disclaimer will be appended · sent copy filed to matter · privilege check on.</span>
              </div>
            )}

            {/* Body */}
            <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px', minHeight: 0, background: '#fff' }}>
              {draft.replyTo && (
                <div style={{
                  borderLeft: '3px solid var(--blue-300)', paddingLeft: 10, marginBottom: 12,
                  background: 'var(--blue-tint)', padding: '8px 10px', borderRadius: 4,
                  fontSize: 11.5, color: MF.ink3, fontFamily: '"Fraunces", Georgia, serif',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 2, color: MF.ink2 }}>On {draft.replyTo.at}, {draft.replyTo.from} wrote:</div>
                  <div style={{ fontSize: 11, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{draft.replyTo.snippet}</div>
                </div>
              )}
              <textarea
                value={draft.body}
                onChange={e => onUpdate({ body: e.target.value })}
                placeholder={draft.replyTo ? 'Write your reply…' : 'Write your message…'}
                style={{
                  width: '100%', minHeight: 240, border: 'none', outline: 'none', resize: 'none',
                  fontFamily: '"Fraunces", Georgia, serif', fontSize: 14, lineHeight: 1.6, color: MF.ink, background: 'transparent',
                }} />
              {/* Signature preview */}
              <div style={{ marginTop: 16, paddingTop: 10, borderTop: `1px dashed ${MF.line}`, fontSize: 12, color: MF.ink3, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 600, color: MF.ink2 }}>Jane Marsh</div>
                <div>Partner · Kosloski Law</div>
                <div className="mf-mono" style={{ fontSize: 10.5 }}>303.555.0141 · jane@kosloskilaw.com</div>
                <div style={{ fontSize: 10, color: MF.ink4, marginTop: 4, fontStyle: 'italic' }}>
                  CONFIDENTIALITY NOTICE: This email may contain privileged and confidential information…
                </div>
              </div>
            </div>

            {/* Footer action bar */}
            <div style={{
              padding: '10px 14px', borderTop: `1px solid ${MF.line}`, background: '#fbfafa',
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap',
            }}>
              <button onClick={onSend}
                      disabled={sentFlash}
                      style={{
                        background: sentFlash ? MF.ok : 'var(--blue-500)',
                        color: '#fff', border: 'none', padding: '7px 16px',
                        borderRadius: 6, font: `600 12.5px ${MF.fUI}`, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                        boxShadow: '0 2px 6px -2px rgba(37,99,168,.5)',
                      }}>
                <Icon n="send" size={12} />
                {sentFlash ? 'Sent · filed ✓' : 'Send'}
              </button>
              <button style={toolBtn} title="Attach file"><Icon n="file" size={14} /></button>
              <button style={toolBtn} title="Insert template" onClick={() => setTemplateOpen(v => !v)}>
                <Icon n="doc" size={14} />
              </button>
              <button style={toolBtn} title="Link document"><Icon n="folder" size={14} /></button>
              <button style={toolBtn} title="Insert signature"><Icon n="user" size={14} /></button>

              <span style={{ flex: 1 }} />

              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: MF.ink3, cursor: 'pointer' }}>
                <input type="checkbox" checked={logTime} onChange={e => setLogTime(e.target.checked)} style={{ margin: 0 }} />
                Log 0.2h to matter
              </label>
              <Chip style={{ fontSize: 10 }}>draft saved · 2s</Chip>

              {/* Template popover */}
              {templateOpen && (
                <div style={{
                  position: 'absolute', bottom: 52, left: 14, zIndex: 5,
                  width: 320, background: '#fff', border: '1px solid var(--blue-200)',
                  borderRadius: 8, boxShadow: '0 10px 30px -8px rgba(12,36,67,.3)',
                  padding: 8,
                }}>
                  <div style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: MF.ink4, padding: '4px 8px' }}>
                    Templates
                  </div>
                  {EMAIL_TEMPLATES.map(tp => (
                    <div key={tp.id}
                         onClick={() => { onUpdate({ body: tp.snippet }); setTemplateOpen(false); }}
                         style={{ padding: '8px 10px', borderRadius: 5, cursor: 'pointer' }}
                         onMouseEnter={e => e.currentTarget.style.background = 'var(--blue-tint)'}
                         onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{tp.name}</div>
                      <div className="mf-ink3" style={{ fontSize: 10.5, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginTop: 2 }}>{tp.snippet.split('\n')[0]}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

const composeInput = {
  border: 'none', outline: 'none', background: 'transparent',
  flex: 1, minWidth: 0,
  font: `400 12.5px ${MF.fUI}`, color: MF.ink,
};
const toolBtn = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: MF.ink3, padding: 6, borderRadius: 4,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
function ComposeRow({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${MF.line2}`, padding: '7px 0' }}>
      <div style={{ width: 50, fontSize: 11, color: MF.ink3, fontWeight: 500, flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>{children}</div>
    </div>
  );
}

Object.assign(window, { PageEmail, MatterEmails });