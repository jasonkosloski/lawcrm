-- CreateTable
CREATE TABLE "portal_status_updates" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "stageLabel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "postedById" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),

    CONSTRAINT "portal_status_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_shared_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "clientTitle" TEXT NOT NULL,
    "clientNote" TEXT,
    "sharedById" TEXT NOT NULL,
    "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_shared_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_status_updates_matterId_postedAt_idx" ON "portal_status_updates"("matterId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "portal_shared_events_eventId_key" ON "portal_shared_events"("eventId");

-- CreateIndex
CREATE INDEX "portal_shared_events_matterId_idx" ON "portal_shared_events"("matterId");

-- AddForeignKey
ALTER TABLE "portal_status_updates" ADD CONSTRAINT "portal_status_updates_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_status_updates" ADD CONSTRAINT "portal_status_updates_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_shared_events" ADD CONSTRAINT "portal_shared_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_shared_events" ADD CONSTRAINT "portal_shared_events_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_shared_events" ADD CONSTRAINT "portal_shared_events_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grant the new portal permissions to every role that can edit matters.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", k FROM "role_permissions",
  unnest(ARRAY['portal.add_updates','portal.edit_updates','portal.delete_updates','portal.share_events']) AS k
WHERE "permission" = 'matters.edit'
ON CONFLICT ("roleId", "permission") DO NOTHING;
