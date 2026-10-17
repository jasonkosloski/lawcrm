-- Quality sweep, Batch 4 (ADR-035 to ADR-038). One migration, expand-only: nothing is
-- dropped except one redundant index (settlements_matterId_idx, superseded by
-- the new unique index on the same column).
--
-- Summary
--   1. Money columns -> DECIMAL(14,2); Settlement.firmFeePercent -> DECIMAL(7,4).
--      NOTE: ALTER COLUMN ... TYPE rounds existing values to the new scale
--      (half away from zero for numeric), so any sub-cent legacy value is
--      rounded to the nearest cent in place. Values are never truncated; the
--      only values that can fail are > 12 integer digits (none in practice).
--   2. PracticeArea.statutePeriodAmount / statutePeriodUnit (calendar SOL
--      periods), backfilled from statutePeriodDays. statutePeriodDays is KEPT
--      (deprecated, no longer read); a later migration drops it.
--   3. New indexes (see perf audit / SCHEMA_NOTES).
--   4. UNIQUE settlements(matterId). The deploy ABORTS with a clear error,
--      before changing anything, if any matter already has 2+ settlements.
--      Nothing is ever deleted by this migration.
--   5. firms.matterVisibility (FIRM default). Not enforced yet (Phase 5).
--   6. Data step: grant the new billing.view permission to every role that
--      already holds a billing.* or trust.* permission. Admin is a wildcard
--      in code and has no role_permissions rows, so it needs none.
--   7. CalendarEvent.visibility gains the value 'private'. The column is a
--      plain TEXT ("default" | "show_details" | "private"), so no DDL.

-- Guard: one settlement per matter. Fail safely, delete nothing.
DO $$
DECLARE
  dup_count integer;
  dup_list text;
BEGIN
  SELECT count(*), string_agg("matterId" || ' (' || n || ')', ', ')
    INTO dup_count, dup_list
  FROM (
    SELECT "matterId", count(*) AS n
    FROM "settlements"
    GROUP BY "matterId"
    HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add UNIQUE settlements(matterId): % matter(s) have more than one settlement: %. Merge or remove the extra settlement rows by hand, then re-run migrate deploy. Nothing was changed.',
      dup_count, dup_list;
  END IF;
END
$$;

-- CreateEnum
CREATE TYPE "SolPeriodUnit" AS ENUM ('DAYS', 'MONTHS', 'YEARS');

-- CreateEnum
CREATE TYPE "MatterVisibility" AS ENUM ('FIRM', 'TEAM');

-- DropIndex
DROP INDEX "settlements_matterId_idx";

-- AlterTable
ALTER TABLE "expenses" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "firms" ADD COLUMN     "matterVisibility" "MatterVisibility" NOT NULL DEFAULT 'FIRM';

-- AlterTable
ALTER TABLE "invoice_payments" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "invoices" ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "taxAmount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "paidAmount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "matters" ALTER COLUMN "trustBalance" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "wipAmount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "practice_areas" ADD COLUMN     "statutePeriodAmount" INTEGER,
ADD COLUMN     "statutePeriodUnit" "SolPeriodUnit";

-- AlterTable
ALTER TABLE "settlement_liens" ALTER COLUMN "originalAmount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "negotiatedAmount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "settlements" ALTER COLUMN "grossAmount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "firmFee" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "firmFeePercent" SET DATA TYPE DECIMAL(7,4),
ALTER COLUMN "advancedCosts" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "clientNet" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "time_entries" ALTER COLUMN "rate" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "trust_transactions" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- CreateIndex
CREATE INDEX "activity_logs_matterId_timestamp_idx" ON "activity_logs"("matterId", "timestamp");

-- CreateIndex
CREATE INDEX "activity_logs_userId_type_timestamp_idx" ON "activity_logs"("userId", "type", "timestamp");

-- CreateIndex
CREATE INDEX "deadlines_status_dueDate_idx" ON "deadlines"("status", "dueDate");

-- CreateIndex
CREATE INDEX "email_attachments_messageId_idx" ON "email_attachments"("messageId");

-- CreateIndex
CREATE INDEX "matter_contacts_contactId_idx" ON "matter_contacts"("contactId");

-- CreateIndex
CREATE INDEX "matter_team_members_userId_removedAt_idx" ON "matter_team_members"("userId", "removedAt");

-- CreateIndex
CREATE INDEX "settlement_approvals_settlementId_idx" ON "settlement_approvals"("settlementId");

-- CreateIndex
CREATE INDEX "settlement_liens_settlementId_idx" ON "settlement_liens"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_matterId_key" ON "settlements"("matterId");

-- CreateIndex
CREATE INDEX "time_entries_invoiceId_idx" ON "time_entries"("invoiceId");

-- Backfill: calendar SOL periods from the legacy day count.
--   days divisible by 365  -> YEARS, amount = days / 365   (730 -> 2 YEARS)
--   anything else          -> DAYS,  amount = days          (180 -> 180 DAYS)
-- (statutePeriodDays held a 365-day year / 30-day month total; only exact
-- whole years can be recovered as calendar units without guessing.)
UPDATE "practice_areas"
SET
  "statutePeriodAmount" = CASE
    WHEN "statutePeriodDays" % 365 = 0 THEN "statutePeriodDays" / 365
    ELSE "statutePeriodDays"
  END,
  "statutePeriodUnit" = CASE
    WHEN "statutePeriodDays" % 365 = 0 THEN 'YEARS'::"SolPeriodUnit"
    ELSE 'DAYS'::"SolPeriodUnit"
  END
WHERE "statutePeriodDays" IS NOT NULL
  AND "statutePeriodDays" > 0;

-- Data: billing.view for every role that already holds a billing.* or
-- trust.* permission (so no one who could use billing loses the tab).
-- Idempotent: existing (roleId, permission) rows are skipped.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", 'billing.view'
FROM "role_permissions"
WHERE ("permission" LIKE 'billing.%' OR "permission" LIKE 'trust.%')
  AND "permission" <> 'billing.view'
ON CONFLICT ("roleId", "permission") DO NOTHING;
