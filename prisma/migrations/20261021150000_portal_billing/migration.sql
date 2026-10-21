-- AlterTable
ALTER TABLE "matters" ADD COLUMN     "portalBillingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Grant the new portal permission to every role that can send invoices.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", 'portal.share_billing' FROM "role_permissions"
WHERE "permission" = 'billing.send_invoice'
ON CONFLICT ("roleId", "permission") DO NOTHING;
