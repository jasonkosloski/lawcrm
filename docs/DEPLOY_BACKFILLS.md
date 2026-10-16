# Deploy backfills

One-off, idempotent data repairs that must run once per environment
after the code change that made them necessary ships. Each is safe to
re-run. Not migrations: no schema change.

## Client party rows (`MatterContact` category `client`)

**Why:** `convertLeadToMatter` used to set `Matter.clientId` without
creating the matching `MatterContact(category="client")` row that
`createMatter` / `updateMatter` always maintained, so every matter
converted from a lead has no client on its Parties tab. The code is
fixed going forward; this repairs existing rows.

**Required deploy step** (after the code deploy, against the target DB):

```
DATABASE_URL=<target> npx tsx scripts/backfill-client-matter-contacts.ts --dry-run
DATABASE_URL=<target> npx tsx scripts/backfill-client-matter-contacts.ts
```

Logic lives in `src/lib/backfill-client-party-rows.ts` (tested). Only
matters with a `clientId` and no `(matter, clientId, client)` party row
are touched; inserts use `skipDuplicates`, so re-running does nothing.
