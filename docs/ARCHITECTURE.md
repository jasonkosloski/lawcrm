# Architecture

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Full-stack React, server components, API routes, file-based routing |
| UI Components | shadcn/ui + Tailwind CSS v4 | Copy-paste components, full control, no runtime dependency |
| Server State | TanStack React Query | Cache management, optimistic updates, background refetching |
| ORM | Prisma 7 | Type-safe queries, migration system, great DX |
| Database | SQLite (dev) → PostgreSQL (prod) | Zero-config local dev, production-grade when deployed |
| Fonts | Inter / JetBrains Mono / Fraunces | Per design handoff — UI / metadata / display |

## Folder Structure

```
src/
├── app/                      # Next.js App Router
│   ├── (dashboard)/          # Route group — all pages inside the app shell
│   │   ├── layout.tsx        # Wraps pages in AppShell (sidebar + topbar)
│   │   ├── page.tsx          # Today/Dashboard
│   │   ├── matters/          # Matters list + detail
│   │   ├── email/            # Email inbox
│   │   ├── calendar/         # Calendar view
│   │   ├── time/             # Time tracking
│   │   ├── billing/          # Invoices, trust, financials
│   │   ├── intake/           # Lead intake queue
│   │   ├── contacts/         # Contact directory
│   │   └── settings/         # Firm settings, integrations
│   ├── api/                  # API route handlers
│   ├── layout.tsx            # Root layout (fonts, providers)
│   └── globals.css           # Design tokens, global styles
├── components/
│   ├── layout/               # App shell, sidebar, topbar
│   ├── shared/               # Reusable business components (matter-picker, etc.)
│   └── ui/                   # shadcn primitives (button, card, dialog, etc.)
├── hooks/                    # Custom React hooks
├── lib/                      # Utilities (prisma client, query client, helpers)
├── types/                    # Shared TypeScript types
└── generated/                # Auto-generated (Prisma client) — gitignored
```

## Data Flow Patterns

### Server Components (default)
Pages and layouts are server components by default. They can directly query Prisma.

```
Page (server) → prisma.matter.findMany() → render HTML
```

### Client Components with React Query
Interactive components that need client-side state use React Query to fetch from API routes.

```
Client Component → useQuery("/api/matters") → API Route → Prisma → JSON response
```

### Mutations
Create/update/delete operations go through API routes, with React Query mutations for optimistic UI.

```
Client → useMutation → POST /api/matters → Prisma → invalidate queries → re-render
```

### When to use which pattern
- **Server component + direct Prisma:** Static or lightly interactive pages (dashboard, matter detail overview)
- **Client component + React Query:** Highly interactive UIs (email inbox, time entry forms, real-time filters)
- **Server Actions:** Simple form submissions where you don't need optimistic UI

## Key Conventions

- **API routes** live at `src/app/api/[resource]/route.ts` and return JSON
- **Page components** are thin — they compose layout + data, delegate rendering to components
- **Business logic** stays in `lib/` functions, not in components or API routes
- **Types** derived from Prisma schema where possible (`Prisma.MatterGetPayload<{}>`)
- **Error handling** at API boundaries; trust internal code and Prisma guarantees
