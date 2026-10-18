# ADR-033: Error boundaries use retry(); the notification bell reads over GET

**Date:** 2026-10-17
**Status:** Accepted

**Context:** In Next 16 an error boundary's `reset()` only re-renders the client tree and does not refetch the server component that threw, so "Try again" re-showed the same error. Separately, a polled Server Action is dispatched one at a time per client, so the bell's poll queued ahead of the user's real mutations (Save waited behind a fetch).

**Decision:**
- Error boundaries call `retry()` (re-fetches and re-renders the segment). `src/app/error.tsx` is the layout-level backstop for errors thrown above any route-level boundary.
- Notification bell state lives in a provider inside `AppShell`. The poll reads through `GET /api/notifications/bell` (`src/app/api/notifications/bell/route.ts`, session-checked, scoped to the session user, never cached); mutations (mark read, mark all read) stay Server Actions. Notification writers and mark-read actions no longer revalidate the layout; the bell and feed are client state.
- Rule of thumb: polled or background **reads** use a GET route handler that authenticates itself (the proxy only checks cookie presence, ADR-028); **mutations** use Server Actions (`docs/ARCHITECTURE.md`).

**Trade-offs:**
- (+) Retry actually recovers from transient failures; saves are not blocked by the poll
- (-) One more route handler to keep guarded and tested
