# UI system v2: evaluation and design

**Date:** 2026-10-20 · **Tier:** Full (app-wide, more than a day) · **Branch:** `ui-overhaul`

## 1. Evaluation of the current UI

Screens reviewed in the running app (seeded local DB, 1440 wide): Today, Matters list,
matter Overview / Billing / Documents, Calendar week, Communication inbox and reader,
Intake, Time week, Reports, Settings → Profile, New matter. Measurements are from
`src/app` + `src/components` (383 files).

### What works and stays
- **The identity:** warm paper ground, white cards, the firm's navy, Fraunces for titles.
  It already reads as a law office rather than a SaaS kit. Keep it.
- **The structure:** sidebar + page header, matter tabs, three-pane email, the Create
  dock, ⌘K palette, URL-driven filters, pagination rules, honest empty states. These are
  sound and are not being redesigned.
- **Data honesty:** dashes for missing values, plurals, `TruncationNotice`.

### What fails, in order of cost to a lawyer reading it all day

1. **Type is too small to work in.** `text-2xs` (10px) appears 1,081 times; 14px
   `text-sm` 156 times. Sub-11px text carries real content: matter names under deadlines,
   timestamps, table meta, badge counts, form labels.
2. **The commonest grey fails contrast.** `ink-4` (#9aa1ad) is 2.6:1 on white and is used
   884 times, mostly at 10px. `ok` (4.28:1) and `warn` (4.37:1) also miss 4.5:1 as text.
3. **Monospace and uppercase are used as decoration.** There are 571 `font-mono` and 194
   `uppercase` uses: page eyebrows ("10 OPEN · 1 CLOSED/SETTLED"), field labels
   ("DISPLAY NAME"), relative dates, matter names in email rows. Small tracked caps in a
   mono face are the hardest text on screen to read, and they're used for the least
   important words.
4. **Colour is spent on chrome, so it can't signal.** A saturated navy fill on the
   active nav item, the Email tab, the inbox mailbox and every primary button. A blue
   gradient hairline over every page. Tinted gradient KPI tiles with icons in coloured
   squares. With colour everywhere, an overdue deadline or a trust shortfall has nothing
   left to stand out with.
5. **One idea, several looks.** Table headers are 11px grey with sort glyphs on Matters
   and 13px bold ink on Intake and Billing. KPIs are tiles on Today and Billing, bars on
   Reports. Labels are sentence case on New matter but uppercase mono on Profile. There
   are 310 raw `<button>`s beside 163 `<Button>`s, so states drift.
6. **Width is wasted or overflowing.** Reports stops ~250px short of the right edge and
   stretches the Utilization card over empty space. The Time week bars have no scale. At
   900px tall the sidebar scrolls, putting Settings below the fold.
7. **Missing states.** No `prefers-reduced-motion` handling; no dark theme (out of scope
   here, see §6).

### The screens' questions (what each must answer first)
| Screen | Question | Biggest thing |
|---|---|---|
| Today | What's due or scheduled for me, and is anything about to blow? | Deadlines with urgency, then agenda |
| Matters | Which matter, and what's next on it? | Name + next deadline, as a date |
| Matter | Where does this case stand and what's next? | Header facts + stage + next deadline |
| Communication | What needs a reply or filing? | Unread / unfiled rows |
| Calendar | Where must I be, and what's due? | The grid; deadlines distinct from events |
| Time | Did I log my day? | Hours per day against the goal |
| Billing | What's owed, held and unbilled? | Trust balance, AR, WIP as figures |

## 2. Direction

Taste-skill app style **achromatic-ledger** (seed 1997934289), with the brand kept:
*the chrome holds no colour; colour is spent only on meaning.* For this firm, meaning
is urgency (overdue, due soon), money movement, status, the matter's own colour (data)
and the one primary action.

**Face:** warm stone ground with ink chrome, the firm's navy as the single hue, Fraunces
on page and matter titles (the "filed page" voice the login already uses).
**Signature element:** the *deadline clock*: a due date always shows as a date plus a
countdown ("Oct 25 · 5d"), coloured only when it matters (≤2 days warn, overdue danger).
It replaces bare "5d" chips everywhere.

## 3. Tokens (globals.css: names kept, values changed)

Keeping token names means the 300+ files that use them change look without edits.

**Ground and surfaces:** `paper` #f7f6f2 (lower chroma), `paper-2` #efede7, cards #fff,
`line` #e6e4de, `line-2` #efede8. Sidebar on the ground with one hairline, no gradient.

**Ink tiers (all ≥ 4.5:1 on white and paper):**
`ink` #14181f · `ink-2` #3a4251 · `ink-3` #5b6270 (≈6:1) · `ink-4` #6b7280 (≈4.6:1).
The current `ink-3` value becomes `ink-4`, so every former `ink-4` use becomes legible.
A new `ink-5` #9aa1ad is only for placeholders, disabled glyphs and decorative icons.

**Brand:** the scale stays. Primary actions use `brand-700` #18406e (a deep navy that
reads near-ink: the style's near-black primary in the firm's own colour). `brand-500`
for links, focus rings and selection marks only.

**Status (text-safe):** `ok` #23744d · `warn` #9a4a26 · `danger` #b02a2a, each with a pale
pill pair (`*-soft` bg, darker ink). Amber `highlight` stays for search hits.

**Type scale (Inter, tabular figures in data):** 12 / 13 / 14 / 16 / 20 / 24.
- `text-3xs` and `text-2xs` are redefined to 11px / 12px, so nothing renders under 11px.
- Body and table cells 13–14px; nav 14px; meta 12px; page title Fraunces 22–24px.
- Mono (JetBrains) only for case numbers, invoice numbers and IDs.
- Uppercase only for at most one context label per screen. Section and field labels
  are sentence case.

**Shape:** cards radius 8, controls 6, chips 4/full; a border *or* a shadow, never both;
shadows only on floating layers. Control height 32 (toolbar) / 36 (forms). Focus:
2px `brand-500` ring, 2px offset. All motion wrapped in `motion-safe`.

## 4. Components (primitives change; callers mostly don't)

- **Sidebar:** 240px on the ground, hairline right. 14px labels on a 32px row; the active
  item is a neutral pill (`paper-2`) with ink label and icon, not a blue fill. Counts
  only on queues (unread email, new leads), in grey text, not chips; "Matters 10" and
  the practice-area counts become grey numerals. The "Practice areas" group collapses
  (remembered per browser) so the column fits 900px. Monogram tile flat navy, no
  gradient or glow.
- **Top bar:** no gradient hairline. Title in Fraunces 22px; the stats eyebrow becomes a
  13px grey line beside or under the title in sentence case ("10 open · 1 closed").
  Breadcrumbs, where real, are 12px sentence-case links.
- **Button:** primary deep navy; secondary white with border; ghost; destructive as
  outlined danger. One primary per screen.
- **Badge / status chip:** pale tint + dark same-hue ink, 12px, 20px tall, never squeezed.
- **KPI strip** (new shared `StatStrip`): one bordered card split by 1px dividers; label
  12px grey above a 24px value; no icons, no tints, no gradients. Used by Today and Billing.
- **Table:** header 12px grey sentence case, no band; rows 44px; numbers right-aligned
  and tabular; zeros in grey; one row-hover tint.
- **Section card header:** 15px semibold title + grey count + optional right action. One
  component instead of hand-rolled headers.
- **Form field:** 13px medium sentence-case label above a 36px input; help text 12px ink-3.
- **Deadline clock** (new `DueLabel`): date + countdown, coloured by urgency.

## 5. Screen changes (after the foundation)

- **Today:** StatStrip replaces tiles; Deadlines moves to the main column's top, with
  urgency; agenda times in 13px tabular Inter.
- **Matters:** next deadline as a DueLabel; zero trust in grey; 14px matter names.
- **Matter:** header facts as one 13px line; tabs 14px; Billing figures in a StatStrip.
- **Communication:** list rows 13–14px with names in ink (grey only for meta); selected
  row takes the neutral active fill; Email/Messages as underline tabs, not a filled pill.
- **Calendar:** deadlines get their own mark (a warn rule with the due icon), distinct
  from events; hour labels 12px.
- **Time:** a goal line on the week bars and labelled hours; legend at 12px.
- **Reports:** the grid uses the full width; cards keep their own height.
- **Settings / forms:** sentence-case labels; the two-column settings row layout.
- **Intake:** header and score styling aligned to the shared Table.

## 6. Out of scope (recorded so it isn't lost)
- **Dark theme:** the tokens make it possible later; it isn't part of v2.
- **Regrouping the 13 matter tabs** (e.g. Events + Deadlines + Tasks as "Schedule"): a
  workflow change that needs the user's call; noted in app-shell.md open work.
- **Client portal:** keeps its own register (UI_PATTERNS §Client portal); it picks up
  the token changes only.
- **Print (invoices):** unchanged.

## 7. Risk and verification
- No schema, permission or data-flow change. The risk is visual regression and broken tests
  that assert on class names or copy (uppercase eyebrows).
- Each phase: `npm run typecheck`, `npm run lint`, full `npm test`, then screenshots of
  the screens in §1 at 1440 compared before and after.
- Phone layout: check the drawer, the matters list and the inbox at 390 wide in a real
  browser before merging.
