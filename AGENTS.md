<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Testing is non-optional

Every new feature ships with at least one test. The pre-commit hook
runs `npm run typecheck && npm test` on every commit and blocks
the commit on failure. See **`docs/TESTING.md`** for the full
discipline — what to test, what NOT to test, file conventions,
running commands. The framework is Vitest; tests live alongside
their source as `*.test.ts`.

If you're adding logic and don't write a test, you're leaving
broken work for the next session. Don't.

# Permissions are non-optional

Every gated capability gets a granular permission key in
`src/lib/permissions.ts` (split into view / add / edit / delete
when the capability has those distinct access levels — don't lump
into "manage_X"). Server actions gate via `requirePermission(...)`;
read-side flags via `currentUserHasPermission(...)`. See
**`docs/PERMISSIONS.md`** for the full reference.

# Mutations are server actions

All create/update/delete goes through server actions in
`src/app/actions/[resource].ts` — permission-gated, activity-logged,
`revalidatePath` for invalidation. Do NOT add API routes for
mutations, and do NOT use React Query mutations (the package is
installed but unused; older docs describing that pattern were wrong).
Reads happen in server components via direct Prisma queries. See
**`docs/ARCHITECTURE.md`** for the full picture.

# Docs are non-optional

`docs/` is living documentation (index at `docs/README.md`), updated
as part of the change that makes it stale — not as a follow-up chore:

- Schema change → entry in `docs/SCHEMA_NOTES.md` (models table + changelog)
- Architectural choice → ADR in `docs/DECISIONS.md`
- Feature started/shipped/descoped → status in `docs/FEATURES.md`
- New reusable UI pattern → `docs/UI_PATTERNS.md`
- Folder structure or data-flow change → `docs/ARCHITECTURE.md`

Don't hand-duplicate what code already declares (permission key
lists, test counts, coverage thresholds) — point at the source file
instead.
