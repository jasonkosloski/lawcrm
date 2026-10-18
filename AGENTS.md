<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Match the process to the risk

Pick the tier by what a mistake would cost, not by how big the
change looks. State the tier in one line at the start of the task
(e.g. "Tier: Light — no schema/money/permissions"); the user can
bump it up or down. This overrides skills that default to the full
brainstorm → spec → plan → subagent flow for all creative work.

| Tier | When | Process |
|---|---|---|
| **Just do it** | Copy, styling, layout, an obvious bug, a contained change to one or two files | Edit, run related tests, commit. No spec, plan, or subagents. |
| **Light** | A real feature with none of the risk triggers below | 5–10 bullet plan in chat for the user to OK, build inline, one `/code-review` at the end. No spec/plan files. |
| **Full** | Any risk trigger | Brainstorm → spec → plan → subagents, reviewing once per phase rather than after every task. |

Risk triggers (any one means Full):

- Schema or migration change
- Money: trust accounting, invoices, fees, expenses
- Permissions, or scope/visibility rules
- Concurrency or locking (two actions racing)
- Data moving between records (lead → matter conversion, merges)
- Expected to take more than a day

Testing, permissions, and docs rules below apply at every tier.

# Testing is non-optional

Every new feature ships with at least one test. The pre-commit hook
(`.husky/pre-commit`) runs typecheck, lint, and only the tests
related to staged `src/` files, and blocks the commit on failure.
Run the full `npm test` before pushing; CI runs it on every push.
See **`docs/TESTING.md`** for the full discipline — what to test, what NOT to test, file conventions,
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

`docs/` is living documentation (map at `docs/README.md`), updated in
the same commit as the change that makes it stale. Code and tests say
what the app does and git says what changed when; docs hold only what
neither can: what's next, why, and how we work.

**Read only what the task needs:** `docs/ROADMAP.md` for priorities,
the one `docs/features/<area>.md` you're working in, and the specific
ADRs it links. Don't load whole folders.

| When you… | Update |
|---|---|
| Start, ship, descope, or reprioritize work | `docs/features/<area>.md` (detail) **and** its line in `docs/ROADMAP.md` |
| Make a choice a future session might undo without knowing why | New ADR in `docs/decisions/` + its row in `decisions/README.md` |
| Find a problem too big for a roadmap line | `docs/issues/<slug>.md`; delete it when fixed |
| Change the schema | `docs/SCHEMA_NOTES.md`, only if there's a non-obvious invariant or trade-off |
| Add a reusable UI pattern / change structure or data flow | `docs/UI_PATTERNS.md` / `docs/ARCHITECTURE.md` |

Keep it lean:
- ROADMAP lines are one line each; detail lives in the feature file.
- Feature files describe end state, not history; aim under ~15KB.
- Don't log what code, tests, or git already record: no changelogs,
  no copies of permission keys, model lists, or test counts.
- Specs and plans in `docs/superpowers/` are working files: fold
  anything lasting into the feature file or an ADR, then delete them
  in the commit that finishes the feature.
