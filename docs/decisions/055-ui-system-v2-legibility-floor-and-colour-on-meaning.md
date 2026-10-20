# ADR-055: UI system v2 — a legibility floor, and colour spent only on meaning

**Date:** 2026-10-20
**Status:** Accepted (refines ADR-004; ADR-003 stands)

**Context:** The app is read all day by lawyers and paralegals. An audit of the v1 UI
found 10px text in 1,081 places, the commonest grey (`ink-4`, 2.6:1) failing contrast in
884, monospace and tracked uppercase used as decoration (571 and 194 uses), and the
brand blue spent on chrome (active nav, tabs, mailbox selection, gradient hairline, tinted
KPI tiles). That left nothing for an overdue deadline or a trust shortfall to stand out
with. The rules that replaced it are in UI_PATTERNS (Identity, Type, Component Patterns).

**Decision:**
- **A floor, enforced by the tokens.** Nothing renders under 11px. Token *values*
  changed and names were kept (`text-2xs` 12, `text-xs` 13, `text-sm` 14; `ink-3`/`ink-4`
  darkened so every word-carrying tier is at least 4.5:1; `ink-5` for placeholders and
  decorative icons only), so all existing callers moved at once.
- **Colour on meaning, not chrome.** The chrome is ink and neutral: the active nav item
  and selected rows are a neutral pill, and tabs are underlined in ink. Colour is for
  urgency (danger overdue, warn due soon), status (pale pill pairs), money movement,
  matter and practice-area colours (data), and the one primary action, in the firm's
  deep navy (`brand-700`).
- **Faces.** Inter for all UI. `font-mono` renders Inter with tabular figures (aligned
  numbers without a code face); JetBrains Mono (`font-code`) only for code. Fraunces
  for page titles, the brand mark and email reading (ADR-004's rule, minus KPI numbers).
- **No ornament.** No gradients, glows, icons in tinted squares or emoji icons. Shadows
  only on floating layers.
- **Shared pieces.** `StatStrip` for headline figures and `DueLabel` ("Oct 25 · 5d") for
  every due date.

**Trade-offs:**
- (+) One token edit fixed most of the legibility and contrast debt; screens stay consistent
  because they share the ramp.
- (+) Urgent states are visible again because nothing else competes with them.
- (−) The UI is less dense: rows are taller and long lists show fewer rows per screen.
  We accept that for readability across an eight-hour day.
- (−) The name `font-mono` no longer means monospace; the comment in `globals.css` and
  UI_PATTERNS say so.

**Undo only if:** a measured need for density outweighs legibility on a specific screen.
In that case, add a scoped compact variant rather than lowering the global floor.
