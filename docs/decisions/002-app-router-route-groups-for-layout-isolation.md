# ADR-002: App Router route groups for layout isolation

**Date:** 2026-04-24
**Status:** Accepted

**Context:** All authenticated pages share the same app shell (sidebar + topbar), but we'll eventually have unauthenticated pages (login, public intake forms) that don't.

**Decision:** Use Next.js route groups: `(dashboard)` for authenticated pages inside the app shell, and future `(auth)` or `(public)` groups for pages without the shell.

**Trade-offs:**
- (+) Clean layout separation without URL nesting
- (+) Easy to add auth checks at the layout level later
- (-) Slightly deeper file nesting
