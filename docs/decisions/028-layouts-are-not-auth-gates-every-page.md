# ADR-028: Layouts are not auth gates; every page authenticates itself

**Date:** 2026-10-16
**Status:** Accepted

**Context:** The (dashboard) layout called `auth()` and redirected, and the docs described it as the authoritative gate. But Next renders a page on a partial (RSC) navigation without re-running its parent layouts, and the proxy only checks that a session cookie is present. A page that read data without its own guard could therefore be reached with a stale or forged cookie, and several pages (billing tab, invoice print route, matters list, lead detail) did exactly that.

**Decision:**

- Every `page.tsx` and `layout.tsx` under `src/app/(dashboard)` and `src/app/print` calls a session guard as the **first `await`** of its default export, before any data read: `requireUser()` (`src/lib/current-user.ts`; redirects to `/login`, never wrap in try/catch), or a stronger `requirePermission(key)` / `requireAdmin()` / `getCurrentUserId()`. All are React-`cache()`d, so repeat calls in a request are free.
- `currentUserHasPermission` is a read-side flag and does not count as a guard.
- `src/app/page-guards.test.ts` statically enforces the rule (first `await` is a guard; no `prisma.` before it). The page allowlist (`PAGE_ALLOWLIST`) is now empty; only `(dashboard)/layout.tsx` (the UX gate itself) and `print/layout.tsx` (no data reads) are exempt layouts.
- The (dashboard) layout and the proxy remain a UX convenience (redirect early, render the shell for signed-in users), not the security boundary. `src/proxy.ts` is an optimistic cookie-presence check only; its matcher excludes `/api/documents/upload` exactly (not `/upload/blob`) because proxy body buffering (`proxyClientMaxBodySize`, 10 MB) would truncate the streaming multipart upload, and that route authenticates itself (401 without a session, 403 without `documents.upload`). `SELF_AUTHENTICATED_PATHS` (cron + blob callback) stays pinned by `src/vercel-config.test.ts`. Cron endpoints authenticate with `isAuthorizedCron` (`src/lib/cron-auth.ts`, constant-time compare, fail closed).
- Where no billing read permission key exists (matter Billing tab, invoice print route), only the session guard was added; no key was invented because that would change who can see billing. Introducing one is a separate decision.

**Trade-offs:**

- (+) Authentication no longer depends on which layouts happen to run
- (+) A new page that forgets the guard fails CI instead of shipping
- (-) One extra line per page; a static scan cannot see guards hidden behind conditionals or helpers, so reviewers still read the first lines of each page
