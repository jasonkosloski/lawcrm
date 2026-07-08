# Architecture

_Last reviewed: 2026-07-06. If the folder tree or data-flow section stops matching the code, fix it here — this doc has drifted before._

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Full-stack React, server components, server actions, file-based routing |
| UI Components | shadcn/ui + Tailwind CSS v4 | Copy-paste components, full control, no runtime dependency |
| Data loading | React Server Components + Prisma | Pages query the DB directly on the server; no client fetch layer |
| Mutations | Server actions (`src/app/actions/`) | Permission-gated, audit-logged, `revalidatePath` for cache invalidation |
| ORM | Prisma 7 | Type-safe queries, migration system, great DX |
| Database | PostgreSQL everywhere | Hosted Prisma Postgres for dev, pooled Postgres in prod; tests use a dockerized Postgres (`docker-compose.test.yml`, port 5433) |
| Auth | Auth.js v5 + argon2id | Credentials provider, JWT sessions; see [AUTH_PLAN.md](./AUTH_PLAN.md) |
| File storage | Driver facade: local disk (dev) / Vercel Blob (prod) | `src/lib/file-storage.ts` + `src/lib/storage/`; prod uploads go client-direct, serving 302s to the blob CDN — ADR-015 |
| Testing | Vitest + happy-dom | See [TESTING.md](./TESTING.md) |
| Fonts | Inter / JetBrains Mono / Fraunces | Per design handoff — UI / metadata / display |

> TanStack React Query is installed and wired in `src/components/providers.tsx`, but nothing currently consumes it — there are no `useQuery`/`useMutation` calls in the codebase. It's reserved for future highly-interactive views. Don't reach for it for mutations; use a server action.

## Folder Structure

```
src/
├── auth.ts                   # Auth.js v5 config (credentials + argon2id, JWT sessions)
├── proxy.ts                  # Edge middleware — auth gate for all app routes
├── app/
│   ├── (dashboard)/          # Route group — all pages inside the app shell
│   │   ├── layout.tsx        # Wraps pages in AppShell (sidebar + topbar); calls auth()
│   │   ├── page.tsx          # Today/Dashboard
│   │   ├── matters/          # List, new, and [id] detail with tab sub-routes:
│   │   │                     #   billing, communication, deadlines, documents, edit,
│   │   │                     #   events, notes, parties, tasks, time, timeline
│   │   ├── intake/           # Lead intake queue + [id] detail (communication, time)
│   │   ├── contacts/         # Contact directory + [id] detail
│   │   ├── calendar/         # Calendar views + events/[eventId]
│   │   ├── communication/    # Unified inbox (email + messenger)
│   │   └── settings/         # firm, team, roles, practice-areas, billing,
│   │                         #   integrations, notifications, activity, security, profile
│   ├── actions/              # ★ ALL mutations live here — ~34 "use server" modules
│   │                         #   (matters, billing, tasks, notes, calls, settlements, …)
│   ├── api/                  # Sanctioned route handlers ONLY: auth handler,
│   │                         #   document download (streams local / 302s blob),
│   │                         #   streaming upload (local driver), blob upload
│   │                         #   token+callback, Google OAuth redirect legs
│   │                         #   (integrations/google/connect+callback).
│   │                         #   Data mutations do NOT go here.
│   ├── login/                # Public login page
│   ├── print/                # Print-friendly renderings (outside app shell)
│   ├── layout.tsx            # Root layout (fonts, providers)
│   └── globals.css           # Design tokens, global styles
├── components/
│   ├── layout/               # App shell, sidebar, topbar
│   ├── shared/               # Reusable business components (matter-picker, etc.)
│   ├── ui/                   # shadcn primitives (button, card, dialog, etc.)
│   └── <feature>/            # Feature folders: matters, calendar, communication,
│                             #   contacts, intake, notes, tasks, settings, …
├── hooks/                    # Custom React hooks
├── lib/                      # Business logic, form schemas/helpers, permissions,
│                             #   activity log, token encryption, prisma client
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

## Security

- **Auth**: Auth.js v5 credentials provider with argon2id hashing (`src/auth.ts`);
  `src/proxy.ts` gates all routes at the edge; JWT session validated per request.
- **Permissions**: granular keys in `src/lib/permissions.ts`, enforced in every
  server action via `requirePermission(...)` and in read paths via
  `currentUserHasPermission(...)`. Full model in [PERMISSIONS.md](./PERMISSIONS.md).
- **Token encryption at rest**: OAuth tokens on `EmailAccount` / `MessengerAccount`
  are transparently encrypted/decrypted by a Prisma client extension
  (`src/lib/email-token-crypto.ts`, `src/lib/email-token-encryption.ts`). See ADR-011.
- **Document storage**: driver facade in `src/lib/file-storage.ts` — `local`
  (./uploads/, dev) or `vercel-blob` (prod; auto-selected by
  `BLOB_READ_WRITE_TOKEN`, `STORAGE_DRIVER` overrides). GB uploads go
  client-direct to Vercel Blob via a permission-gated token route; downloads
  are session-gated, then streamed (local) or 302'd to the blob CDN. Blob URLs
  are unguessable-but-public bearer URLs on an isolated origin — trade-offs in
  ADR-015.
- **Audit log**: mutating actions record to the activity log (`src/lib/activity-log.ts`),
  surfaced at Settings → Activity.

## Key Conventions

- **Mutations** are server actions in `src/app/actions/[resource].ts`, gated by
  `requirePermission`, tested alongside as `[resource].test.ts`
- **Page components** are thin — they compose layout + data, delegate rendering to components
- **Business logic** stays in `lib/` functions, not in components or actions;
  form schemas/helpers live in `lib/` so they're unit-testable
- **Types** derived from Prisma schema where possible (`Prisma.MatterGetPayload<{}>`)
- **Error handling** at action boundaries; trust internal code and Prisma guarantees

## Related docs

[FEATURES.md](./FEATURES.md) — roadmap/status · [SCHEMA_NOTES.md](./SCHEMA_NOTES.md) — data model ·
[PERMISSIONS.md](./PERMISSIONS.md) — RBAC · [TESTING.md](./TESTING.md) — test discipline ·
[DECISIONS.md](./DECISIONS.md) — ADRs · [UI_PATTERNS.md](./UI_PATTERNS.md) — component conventions ·
[AUTH_PLAN.md](./AUTH_PLAN.md) — auth phases
