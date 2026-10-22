# Architecture

_If the folder tree or data-flow section stops matching the code, fix it here._

## Tech Stack

| Layer         | Technology                                           | Why                                                                                                                                                                                       |
| ------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework     | Next.js 16 (App Router)                              | Full-stack React, server components, server actions, file-based routing                                                                                                                   |
| UI Components | shadcn/ui + Tailwind CSS v4                          | Copy-paste components, full control, no runtime dependency                                                                                                                                |
| Data loading  | React Server Components + Prisma                     | Pages query the DB directly on the server; no client fetch layer                                                                                                                          |
| Mutations     | Server actions (`src/app/actions/`)                  | Permission-gated, audit-logged, `revalidatePath` for cache invalidation                                                                                                                   |
| ORM           | Prisma 7                                             | Type-safe queries, migration system, great DX                                                                                                                                             |
| Database      | PostgreSQL everywhere                                | Prisma Postgres (Vercel integration) — separate `lawcrm-dev` database for local dev, production database for prod; tests use a dockerized Postgres (`docker-compose.test.yml`, port 5433) |
| Auth          | Clerk (staff, Google sign-in)                        | `clerkMiddleware` + `getStaffAuth()`; see [features/auth.md](./features/auth.md)                                                                                                          |
| File storage  | Driver facade: local disk (dev) / Vercel Blob (prod) | `src/lib/file-storage.ts` + `src/lib/storage/`; prod uploads go client-direct, serving 302s to the blob CDN — ADR-015                                                                     |
| Testing       | Vitest + happy-dom                                   | See [TESTING.md](./TESTING.md)                                                                                                                                                            |
| Fonts         | Inter / JetBrains Mono / Fraunces                    | Per design handoff — UI / metadata / display                                                                                                                                              |

## Folder Structure

```
src/
├── proxy.ts                  # Optimistic cookie-presence redirect for app routes (UX only;
│                             #   pages authenticate themselves — see Security)
├── app/
│   ├── (dashboard)/          # Route group — all pages inside the app shell
│   │   ├── layout.tsx        # Wraps pages in AppShell (sidebar, timer, notification bell
│   │   │                     #   provider); a UX gate only. The TopBar is rendered per page.
│   │   ├── page.tsx          # Today/Dashboard
│   │   ├── matters/          # List, new, and [id] detail with tab sub-routes:
│   │   │                     #   billing, communication, deadlines, documents, edit,
│   │   │                     #   events, evidence, notes, parties, records, tasks, time, timeline
│   │   ├── intake/           # Lead intake queue + [id] detail with its own tab routes
│   │   ├── contacts/         # Contact directory + [id] detail
│   │   ├── calendar/         # Calendar views + events/new (events are edited in the
│   │   │                     #   modal; there is no standalone edit route)
│   │   ├── communication/    # Unified inbox (email + messenger)
│   │   └── settings/         # firm, team, roles, practice-areas, billing,
│   │                         #   integrations, notifications, activity, security, profile
│   ├── actions/              # ★ ALL mutations live here — one "use server" module per resource
│   │                         #   (matters, billing, tasks, notes, calls, settlements, …)
│   │   ├── api/                  # Sanctioned route handlers ONLY: Clerk webhook,
│   │                         #   document download (streams local / 302s blob),
│   │                         #   streaming upload (local driver), blob upload
│   │                         #   token+callback, Google OAuth redirect legs
│   │                         #   (integrations/google/connect+callback), cron
│   │                         #   endpoints (email-sync, notification-sweep),
│   │                         #   email-attachments, and the session-checked GET
│   │                         #   notifications/bell read (see Interactivity).
│   │                         #   Data mutations do NOT go here.
│   ├── (portal)/portal/      # Client portal pages (served at / on PORTAL_HOST; see Security)
│   ├── login/                # Public login page
│   ├── print/                # Print-friendly renderings (outside app shell)
│   ├── layout.tsx            # Root layout (fonts, providers)
│   └── globals.css           # Design tokens, global styles
├── components/
│   ├── layout/               # App shell, sidebar, topbar
│   ├── shared/               # Reusable business components (matter-picker, etc.)
│   ├── documents/            # DocumentsBrowser + DocumentViewerBody, shared by
│   │                         #   matter and intake (lead) Documents routes
│   ├── records-requests/     # Records tab, composer, request detail page, type editor
│   ├── ui/                   # shadcn primitives (button, card, dialog, etc.)
│   └── <feature>/            # Feature folders: matters, calendar, communication,
│                             #   contacts, intake, notes, tasks, settings, …
├── hooks/                    # Custom React hooks
├── lib/                      # Business logic, form schemas/helpers, permissions,
│                             #   activity log, token encryption, prisma client,
│                             #   record-scope.ts + scope-access.ts (matter-or-lead
│                             #   scope resolution and access checks),
│                             #   records-requests/ (domain logic)
├── test/                     # Shared test setup/utilities
├── types/                    # Shared TypeScript types
└── generated/                # Auto-generated (Prisma client) — gitignored
```

## Data Flow Patterns

### Reads — server components + direct Prisma (default)

Pages and layouts are server components. They query Prisma directly and render HTML.

```
Page (server) → prisma.matter.findMany() → render HTML
```

### Mutations — server actions (the only sanctioned pattern)

Every create/update/delete is a server action in `src/app/actions/`. The canonical shape:

```
Client form/component → server action
  → requirePermission("matters.edit")     // throws if not granted
  → zod-validated input
  → prisma write
  → logActivity(...)                      // audit trail
  → revalidatePath("/matters/[id]")       // cache invalidation
```

Do **not** add API routes for mutations, and do not use React Query mutations —
that pattern appears in older docs but was never how this codebase evolved.

### Interactivity

Client components receive data as props from their server-component parent and
call server actions directly. Optimistic UI, where needed, is local component
state (e.g. `useOptimistic`), not a client cache.

Polled reads go through a GET route handler, not a server action: Server
Actions are dispatched one at a time per client, so a poll would queue a user's
mutation behind it. The notification bell polls `/api/notifications/bell`
(session-checked); its state lives in the `NotificationBellProvider` in the app
shell, mutations stay server actions, and notification writers no longer
revalidate the layout. Forms and dialogs that must keep input after a server
error follow the React 19 patterns in [UI_PATTERNS.md](./UI_PATTERNS.md).

### Request-scoped helpers

- `getSession()` (`src/lib/session.ts`) is the single request-cached `auth()`
  read; `requireUser()` / `getCurrentUserId()` (`src/lib/current-user.ts`) sit
  on it. Sidebar display data comes from `getSidebarData()`.
- `getCurrentFirm` / `getFirmGoals` are React-cached per request; use the
  uncached `loadCurrentFirm` / `loadFirmGoals` only inside actions that mutate
  those rows and whose page re-renders in the same request.
- `src/lib/prisma.ts` sizes the pg pool at 5 per instance (override with
  `DATABASE_POOL_MAX`, ADR-032); tests run a smaller pool (see TESTING.md).
- `UserFacingError` / `toUserMessage` (`src/lib/user-facing-error.ts`): actions
  throw `UserFacingError` for messages meant for users; anything else is logged
  server-side and the client sees a generic message.
- Money: computed currency amounts round to cents HALF_UP via `roundMoney`
  (`src/lib/money.ts`, ADR-024). Invoice generation locks the matter row
  (`FOR UPDATE`) and links only unbilled rows with a count check; status
  transitions use status/paidAmount predicates or an invoice row lock.
- Dates: ADR-012. Formatting rules for client components are in UI_PATTERNS.md.

## Security

- **Auth**: staff sign in with Clerk (Google); `src/proxy.ts` runs `clerkMiddleware` as an
  optimistic redirect (its matcher excludes `/api/documents/upload` so streaming uploads
  aren't body-buffered) and every page/action resolves the firm user through
  `getStaffAuth()` (`src/lib/staff-auth.ts`); redirects after login go through the
  strict `safeRedirectPath` (`src/lib/safe-redirect.ts`).
- **Host routing and the client portal** (ADR-051): `PORTAL_HOST` (`portal.localhost` in dev) is a second domain on the same project. `src/proxy.ts` rewrites every path on that host into the `(portal)/portal` route group (staff paths 404 there, no staff cookie gate) and 404s `/portal/*` on the staff host. Portal clients authenticate with their own magic-link identity and a host-only `__Host-portal_session` cookie; isolation is also enforced in the session readers (`getPortalIdentity` checks the host), not just the proxy. Portal pages call `requirePortalIdentity` first. See [features/client-portal.md](./features/client-portal.md).
- **Page guards**: layouts are not auth gates; every `page.tsx`/`layout.tsx` calls a guard as its first `await` (ADR-028). See [PERMISSIONS.md](./PERMISSIONS.md).
- **Cron endpoints** (`/api/email-sync`, `/api/notification-sweep`) authenticate
  with `isAuthorizedCron` (`src/lib/cron-auth.ts`, constant-time compare, fails
  closed; `CRON_SECRET` is required in production) and are listed in the proxy's
  self-authenticated paths (pinned by `src/vercel-config.test.ts`). Response
  security headers are set in `next.config.ts`.
- **Matter access (ethical walls, ADR-039) and permissions**: hidden == 404; reads add `matterAccessWhere(userId)`, pages/actions assert (`src/lib/matter-access.ts`); granular keys in `src/lib/permissions.ts` via `requirePermission` / `currentUserHasPermission`. Full model in [PERMISSIONS.md](./PERMISSIONS.md).
- **Token encryption at rest**: OAuth tokens on `EmailAccount` / `MessengerAccount`
  are transparently encrypted/decrypted by a Prisma client extension
  (`src/lib/email-token-crypto.ts`, `src/lib/email-token-encryption.ts`). See ADR-011.
- **Document storage**: driver facade in `src/lib/file-storage.ts` — `local`
  (./uploads/, dev) or `vercel-blob` (prod; auto-selected by
  `BLOB_READ_WRITE_TOKEN`, `STORAGE_DRIVER` overrides). GB uploads go
  client-direct to Vercel Blob via a permission-gated token route; downloads
  are session-gated, then streamed (local) or 302'd to a short-lived presigned
  URL for that one file — the Blob store is private (ADR-015, ADR-018).
- **Automations**: firm deadline rules + task lists (`src/lib/automations/` —
  pure date planning in `deadline-plan.ts`, transactional apply in `apply.ts`),
  applied on demand from a matter or automatically on `matter_created` via
  AutoApply defaults (ADR-019).
- **Captures / notes**: sibling records are each gated by their own create key (PERMISSIONS.md, ADR-025). Events minted this way share `src/lib/calendar-default-attendees.ts` (default attendees, min-firm-attendee invariant) with the calendar create path and are pushed to Google Calendar after commit.
- **Audit log**: `logActivity` (best-effort) and `logActivityTx(tx, …)` (inside the
  caller's transaction, for governance and money events) in
  `src/lib/activity-log.ts`; `logAuditEntry` (`src/lib/audit-entry.ts`) records
  field-names-only entries for settings-style edits. Surfaced at Settings →
  Activity. Coverage is not yet universal (invoice/expense/permission writers
  still log under type `filing`), so don't treat "every mutation is audited" as
  an invariant.

## Notable shared modules

Pointers only; read the file headers for behavior.

- Captures/notes: `capture-permissions.ts`, `capture-access.ts`, `note-captures.ts`,
  `note-threads.ts`, `note-access.ts`, `calendar-default-attendees.ts`
  (`addDefaultEventAttendees`, `resolveAutoAddTeam`; Google push happens after
  commit by collecting event ids inside the transaction).
- Calendar: `event-schedule.ts` (profile-zone wall clock vs date-only keys),
  `components/calendar/grid-time.ts` (zone-aware grid math), `bucket-items.ts`,
  `queries/calendar-edit-flags.ts` (`getEditableEventIds`, same resolver as the
  actions).
- Time/billing/settlements: `time-entry-schema.ts`, `time-entry-constants.ts`,
  `queries/billing-expenses.ts` (predicate must match the `expense.findMany` in
  `generateInvoiceFromWip` / `bundleAsInternalRecord`), `settlement-waterfall.ts`.
- Matters: `matter-name.ts`, `fee-structure-constants.ts`, `hooks/use-url-params.ts`.
- Search: client-safe constants in `lib/constants/search.ts`; palette rows need a
  unique uid (`paletteValue`).
- Uploads never go through server actions (1 MB body cap): the composer and
  multi-file uploader use the busboy route (local driver) or client-direct Blob,
  chosen by the `storageDriver` prop.
- Google: `gmailFetch` has a 60 s per-request timeout (OAuth 30 s) and a host
  allowlist; `isTransientInfraError` classifies retryable failures; sync is
  claimed per account via compare-and-set on `EmailAccount.syncStatus`/`updatedAt`.
- Dashboard: `lib/activity-icons.ts` is the single activity icon map; the deadline
  sweep runs via `after()` with the hourly `/api/notification-sweep` cron as the
  primary driver.
- Safety: `safe-redirect.ts` (all user-supplied redirect targets), `seed-guard.ts`
  (seed/reset refuse non-local databases), `sanitize-html.ts` (`sanitizeUserHtml`,
  `sanitizeEmailHtml`).

## Key Conventions

- **Mutations** are server actions in `src/app/actions/[resource].ts`, gated by
  `requirePermission`, tested alongside as `[resource].test.ts`. A resource
  too big for one file becomes a folder (`actions/billing/`): one
  "use server" file per area, plain shared helpers in `helpers.ts`, and an
  `index.ts` barrel (no directive) so callers and `vi.mock` paths still
  use `@/app/actions/billing`
- **Page components** are thin — they compose layout + data, delegate rendering to components
- **Business logic** stays in `lib/` functions, not in components or actions;
  form schemas/helpers live in `lib/` so they're unit-testable
- **Types** derived from Prisma schema where possible (`Prisma.MatterGetPayload<{}>`)
- **Error handling** at action boundaries; trust internal code and Prisma guarantees

## Related docs

[ROADMAP.md](./ROADMAP.md) — roadmap/status · [SCHEMA_NOTES.md](./SCHEMA_NOTES.md) — data model ·
[PERMISSIONS.md](./PERMISSIONS.md) — RBAC · [TESTING.md](./TESTING.md) — test discipline ·
[decisions/](./decisions/README.md) — ADRs · [UI_PATTERNS.md](./UI_PATTERNS.md) — component conventions ·
[features/](./features/) — per-area behaviour (auth: [features/auth.md](./features/auth.md))
