-- AlterTable
ALTER TABLE "practice_areas" ADD COLUMN     "allowedBillingTypes" TEXT[] DEFAULT ARRAY['hourly', 'flat', 'contingent', 'court_appointed', 'pro_bono']::TEXT[],
ADD COLUMN     "defaultBillingType" TEXT NOT NULL DEFAULT 'contingent';

-- Backfill from the legacy billing mode.
UPDATE "practice_areas" SET "defaultBillingType" = CASE "defaultBillingMode"
  WHEN 'court_voucher' THEN 'court_appointed'
  WHEN 'none' THEN 'pro_bono'
  ELSE 'contingent' END;
