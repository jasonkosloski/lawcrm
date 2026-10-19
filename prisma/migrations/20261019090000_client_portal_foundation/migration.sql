-- AlterTable
ALTER TABLE "firms" ADD COLUMN     "portalEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "portal_identities" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_matter_access" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "portal_matter_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_login_tokens" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_login_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sessions" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_link_requests" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_link_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_identities_contactId_key" ON "portal_identities"("contactId");

-- CreateIndex
CREATE INDEX "portal_identities_email_idx" ON "portal_identities"("email");

-- CreateIndex
CREATE INDEX "portal_matter_access_matterId_idx" ON "portal_matter_access"("matterId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_matter_access_identityId_matterId_key" ON "portal_matter_access"("identityId", "matterId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_login_tokens_tokenHash_key" ON "portal_login_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "portal_login_tokens_identityId_idx" ON "portal_login_tokens"("identityId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_tokenHash_key" ON "portal_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "portal_sessions_identityId_idx" ON "portal_sessions"("identityId");

-- CreateIndex
CREATE INDEX "portal_link_requests_emailHash_createdAt_idx" ON "portal_link_requests"("emailHash", "createdAt");

-- CreateIndex
CREATE INDEX "portal_link_requests_ipHash_createdAt_idx" ON "portal_link_requests"("ipHash", "createdAt");

-- AddForeignKey
ALTER TABLE "portal_identities" ADD CONSTRAINT "portal_identities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_matter_access" ADD CONSTRAINT "portal_matter_access_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "portal_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_matter_access" ADD CONSTRAINT "portal_matter_access_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_login_tokens" ADD CONSTRAINT "portal_login_tokens_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "portal_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "portal_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: roles that can edit matters get the new portal permissions.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", k FROM "role_permissions", unnest(ARRAY['portal.view','portal.invite','portal.revoke']) AS k
WHERE "permission" = 'matters.edit'
ON CONFLICT ("roleId", "permission") DO NOTHING;
