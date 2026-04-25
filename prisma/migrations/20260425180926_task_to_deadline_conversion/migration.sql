-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_deadlines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "sourceType" TEXT,
    "sourceRef" TEXT,
    "description" TEXT,
    "ownerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "noteId" TEXT,
    "eventId" TEXT,
    "parentTaskId" TEXT,
    "emailThreadId" TEXT,
    "messengerItemId" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "deadlines_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "deadlines_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deadlines_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deadlines_emailThreadId_fkey" FOREIGN KEY ("emailThreadId") REFERENCES "email_threads" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deadlines_messengerItemId_fkey" FOREIGN KEY ("messengerItemId") REFERENCES "messenger_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deadlines_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deadlines_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "tasks" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_deadlines" ("completedAt", "createdAt", "description", "dueDate", "emailThreadId", "eventId", "id", "kind", "matterId", "messengerItemId", "noteId", "ownerId", "sourceRef", "sourceType", "status", "title", "updatedAt") SELECT "completedAt", "createdAt", "description", "dueDate", "emailThreadId", "eventId", "id", "kind", "matterId", "messengerItemId", "noteId", "ownerId", "sourceRef", "sourceType", "status", "title", "updatedAt" FROM "deadlines";
DROP TABLE "deadlines";
ALTER TABLE "new_deadlines" RENAME TO "deadlines";
CREATE INDEX "deadlines_matterId_idx" ON "deadlines"("matterId");
CREATE INDEX "deadlines_dueDate_idx" ON "deadlines"("dueDate");
CREATE INDEX "deadlines_status_idx" ON "deadlines"("status");
CREATE INDEX "deadlines_noteId_idx" ON "deadlines"("noteId");
CREATE INDEX "deadlines_emailThreadId_idx" ON "deadlines"("emailThreadId");
CREATE INDEX "deadlines_messengerItemId_idx" ON "deadlines"("messengerItemId");
CREATE INDEX "deadlines_eventId_idx" ON "deadlines"("eventId");
CREATE INDEX "deadlines_parentTaskId_idx" ON "deadlines"("parentTaskId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
