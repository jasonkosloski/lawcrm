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
    CONSTRAINT "deadlines_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_deadlines" ("completedAt", "createdAt", "description", "dueDate", "emailThreadId", "id", "kind", "matterId", "messengerItemId", "noteId", "ownerId", "sourceRef", "sourceType", "status", "title", "updatedAt") SELECT "completedAt", "createdAt", "description", "dueDate", "emailThreadId", "id", "kind", "matterId", "messengerItemId", "noteId", "ownerId", "sourceRef", "sourceType", "status", "title", "updatedAt" FROM "deadlines";
DROP TABLE "deadlines";
ALTER TABLE "new_deadlines" RENAME TO "deadlines";
CREATE INDEX "deadlines_matterId_idx" ON "deadlines"("matterId");
CREATE INDEX "deadlines_dueDate_idx" ON "deadlines"("dueDate");
CREATE INDEX "deadlines_status_idx" ON "deadlines"("status");
CREATE INDEX "deadlines_noteId_idx" ON "deadlines"("noteId");
CREATE INDEX "deadlines_emailThreadId_idx" ON "deadlines"("emailThreadId");
CREATE INDEX "deadlines_messengerItemId_idx" ON "deadlines"("messengerItemId");
CREATE INDEX "deadlines_eventId_idx" ON "deadlines"("eventId");
CREATE TABLE "new_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matterId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'open',
    "dueDate" DATETIME,
    "ownerId" TEXT,
    "deadlineId" TEXT,
    "eventId" TEXT,
    "noteId" TEXT,
    "emailThreadId" TEXT,
    "messengerItemId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tasks_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tasks_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_emailThreadId_fkey" FOREIGN KEY ("emailThreadId") REFERENCES "email_threads" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_messengerItemId_fkey" FOREIGN KEY ("messengerItemId") REFERENCES "messenger_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "deadlines" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_tasks" ("completedAt", "createdAt", "deadlineId", "description", "dueDate", "emailThreadId", "id", "matterId", "messengerItemId", "noteId", "ownerId", "priority", "sortOrder", "status", "title", "updatedAt") SELECT "completedAt", "createdAt", "deadlineId", "description", "dueDate", "emailThreadId", "id", "matterId", "messengerItemId", "noteId", "ownerId", "priority", "sortOrder", "status", "title", "updatedAt" FROM "tasks";
DROP TABLE "tasks";
ALTER TABLE "new_tasks" RENAME TO "tasks";
CREATE INDEX "tasks_matterId_idx" ON "tasks"("matterId");
CREATE INDEX "tasks_status_idx" ON "tasks"("status");
CREATE INDEX "tasks_ownerId_idx" ON "tasks"("ownerId");
CREATE INDEX "tasks_noteId_idx" ON "tasks"("noteId");
CREATE INDEX "tasks_emailThreadId_idx" ON "tasks"("emailThreadId");
CREATE INDEX "tasks_messengerItemId_idx" ON "tasks"("messengerItemId");
CREATE INDEX "tasks_eventId_idx" ON "tasks"("eventId");
CREATE INDEX "tasks_deadlineId_idx" ON "tasks"("deadlineId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
