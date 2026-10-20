# ADR-004: Fraunces for display only, Inter for all UI chrome

**Date:** 2026-04-24
**Status:** Accepted, refined by [ADR-055](055-ui-system-v2-legibility-floor-and-colour-on-meaning.md) (no Fraunces on KPI numbers; no JetBrains Mono outside code)

**Context:** The design uses three fonts. Fraunces is a personality font that should be used sparingly.

**Decision:** Fraunces is used exclusively for:
- Page titles (h1 in topbar)
- Email subjects
- Email body paragraphs
- KPI large numbers

Everything else — nav, buttons, labels, table cells, chips, inputs — uses Inter. JetBrains Mono for timestamps, metadata, and monospace elements.

**Rationale:** Over-using Fraunces would dilute the brand feel and make the UI feel like a blog rather than a professional tool.
