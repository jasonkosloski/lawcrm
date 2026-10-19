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
DATABASE_URL=<target> npx tsx --conditions=react-server scripts/backfill-client-matter-contacts.ts --dry-run
DATABASE_URL=<target> npx tsx --conditions=react-server scripts/backfill-client-matter-contacts.ts
```

Logic lives in `src/lib/backfill-client-party-rows.ts` (tested). Only
matters with a `clientId` and no `(matter, clientId, client)` party row
are touched; inserts use `skipDuplicates`, so re-running does nothing.

---

# Deploy steps: Batch 4 migration `20261017120000_quality_sweep`

A schema migration (not a backfill). Run it once per environment, **production last**, after deploying the matching code (the code reads the new columns, so the order is: migrate first, then the app, or both in the same window; the old app version keeps working against the new schema because nothing was dropped). Rationale: ADR-035 to ADR-038 in `decisions/`, and `SCHEMA_NOTES.md`.

## 1. Pre-check: duplicate settlements (read-only)

The migration adds `UNIQUE settlements("matterId")`. If any matter has two or more settlement rows the migration **aborts before changing anything** with an error naming the matters. Check first:

```sql
SELECT "matterId", count(*) FROM settlements GROUP BY 1 HAVING count(*) > 1;
```

Zero rows: continue. Any rows: look at them (`SELECT * FROM settlements WHERE "matterId" = '<id>' ORDER BY "createdAt"`), decide which to keep, merge its liens / approvals by hand if needed, delete the extras yourself, and re-run the check. The migration never deletes data.

## 2. Back up, then run the migration

Take a database snapshot / `pg_dump` first (the money-column step rounds values in place and cannot be undone from the database).

```bash
# Load the PRODUCTION env (however you normally do), then:
export DIRECT_DATABASE_URL="$DATABASE_URL"   # see the gotcha below
npx prisma migrate status                    # should list only 20261017120000_quality_sweep as pending
npx prisma migrate deploy
npx prisma migrate status                    # "Database schema is up to date"
```

**DIRECT_DATABASE_URL gotcha:** `prisma.config.ts` prefers `DIRECT_DATABASE_URL` over `DATABASE_URL`. A local `.env` points `DIRECT_DATABASE_URL` at the DEV database, so after loading the production env you must set `DIRECT_DATABASE_URL="$DATABASE_URL"` (or point both at the non-pooled production URL) or `migrate deploy` runs against dev. Verify with `npx prisma migrate status` (it prints the target host) before deploying.

## 3. What the migration changes (for the operator)

- **Money rounding (data-changing):** every money column becomes `DECIMAL(14,2)` and `firmFeePercent` becomes `DECIMAL(7,4)`. Postgres rounds existing values to that scale in place (half away from zero). Sub-cent legacy values (for example an unrounded percent-derived fee such as `5000.525`) become `5000.53`. Display and balances already round to cents, so nothing visible should move; run a quick before/after total of `invoices."totalAmount"` and `matters."trustBalance"` if you want proof.
- **SOL periods (data-changing):** `practice_areas."statutePeriodAmount"` / `"statutePeriodUnit"` are filled from `"statutePeriodDays"`: a multiple of 365 becomes YEARS (730 -> 2 YEARS), anything else becomes DAYS (180 -> 180 DAYS). An area that was entered as months (for example 18 months stored as 540) comes back as 540 DAYS; re-enter it as `18 Months` under Settings -> Practice areas. `statutePeriodDays` is left in place (deprecated, unread).
- **billing.view (data-changing):** one `role_permissions` row (`billing.view`) is added to every role that already holds a `billing.*` or `trust.*` permission. Admin needs none. Grant `billing.view` to any other role that should see the Billing tab (Settings -> Roles).
- New indexes, the unique settlement index, `firms."matterVisibility"` (all rows `FIRM`) and the two enums. Nothing is dropped except the plain `settlements_matterId_idx`, superseded by the unique index.

## 4. After deploying

- Open Settings -> Practice areas and confirm each SOL area shows the expected amount and unit.
- Existing matters keep their stored SOL dates. A date that was auto-computed under the old 365-day rule may differ by a day from the new calendar result; it is treated as a manual date until the matter is edited and is never rewritten silently.
- Confirm a billing user still sees the matter Billing tab and a non-billing user does not.

# Deploy steps: client portal foundation

Migrations `20261019090000_client_portal_foundation` (new tables, `firms."portalEnabled"` default false, grants `portal.view/invite/revoke` to every role holding `matters.edit`) and `20261019091000_portal_identity_email_unique`. Nothing is dropped; the portal stays off until step 5.

1. Provision Resend via the Vercel Marketplace; set `RESEND_API_KEY` and `EMAIL_FROM` (SPF/DKIM for the sending domain first).
2. Add `portal.<domain>` to the Vercel project and DNS.
3. Set `PORTAL_HOST` to that host.
4. Back up, load the PRODUCTION env, `export DIRECT_DATABASE_URL="$DATABASE_URL"` (see the gotcha above), `npx prisma migrate status`, then `npx prisma migrate deploy`.
5. Settings, Firm: turn on "Client portal enabled".
6. Invite a test contact from a matter's Portal card; confirm the email arrives and signs in on the portal host, and that the portal host serves no staff pages.
