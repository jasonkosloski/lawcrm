-- CreateTable
CREATE TABLE "portal_threads" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "lastFromClient" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorKind" TEXT NOT NULL,
    "authorIdentityId" TEXT,
    "authorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_read_states" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT,
    "identityId" TEXT,
    "lastReadAt" TIMESTAMP(3) NOT NULL,
    "lastEmailedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_read_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_threads_matterId_key" ON "portal_threads"("matterId");

-- CreateIndex
CREATE INDEX "portal_messages_threadId_createdAt_idx" ON "portal_messages"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "portal_read_states_threadId_userId_key" ON "portal_read_states"("threadId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_read_states_threadId_identityId_key" ON "portal_read_states"("threadId", "identityId");

-- AddForeignKey
ALTER TABLE "portal_threads" ADD CONSTRAINT "portal_threads_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "portal_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_authorIdentityId_fkey" FOREIGN KEY ("authorIdentityId") REFERENCES "portal_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_read_states" ADD CONSTRAINT "portal_read_states_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "portal_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_read_states" ADD CONSTRAINT "portal_read_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_read_states" ADD CONSTRAINT "portal_read_states_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "portal_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grant the new portal permissions to every role that can edit matters.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", k FROM "role_permissions",
  unnest(ARRAY['portal.view_messages','portal.send_messages']) AS k
WHERE "permission" = 'matters.edit'
ON CONFLICT ("roleId", "permission") DO NOTHING;
