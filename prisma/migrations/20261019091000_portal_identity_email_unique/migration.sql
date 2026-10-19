-- DropIndex
DROP INDEX "portal_identities_email_idx";

-- CreateIndex
CREATE UNIQUE INDEX "portal_identities_email_key" ON "portal_identities"("email");

