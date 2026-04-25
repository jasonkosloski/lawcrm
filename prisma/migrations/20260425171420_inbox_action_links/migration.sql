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
    "emailThreadId" TEXT,
    "messengerItemId" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "deadlines_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "deadlines_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deadlines_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deadlines_emailThreadId_fkey" FOREIGN KEY ("emailThreadId") REFERENCES "email_threads" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deadlines_messengerItemId_fkey" FOREIGN KEY ("messengerItemId") REFERENCES "messenger_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_deadlines" ("completedAt", "createdAt", "description", "dueDate", "id", "kind", "matterId", "noteId", "ownerId", "sourceRef", "sourceType", "status", "title", "updatedAt") SELECT "completedAt", "createdAt", "description", "dueDate", "id", "kind", "matterId", "noteId", "ownerId", "sourceRef", "sourceType", "status", "title", "updatedAt" FROM "deadlines";
DROP TABLE "deadlines";
ALTER TABLE "new_deadlines" RENAME TO "deadlines";
CREATE INDEX "deadlines_matterId_idx" ON "deadlines"("matterId");
CREATE INDEX "deadlines_dueDate_idx" ON "deadlines"("dueDate");
CREATE INDEX "deadlines_status_idx" ON "deadlines"("status");
CREATE INDEX "deadlines_noteId_idx" ON "deadlines"("noteId");
CREATE INDEX "deadlines_emailThreadId_idx" ON "deadlines"("emailThreadId");
CREATE INDEX "deadlines_messengerItemId_idx" ON "deadlines"("messengerItemId");
CREATE TABLE "new_notes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matterId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'note',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "parentNoteId" TEXT,
    "calendarEventId" TEXT,
    "taskId" TEXT,
    "deadlineId" TEXT,
    "timeEntryId" TEXT,
    "emailThreadId" TEXT,
    "messengerItemId" TEXT,
    CONSTRAINT "notes_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "notes_parentNoteId_fkey" FOREIGN KEY ("parentNoteId") REFERENCES "notes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notes_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "calendar_events" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "notes_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "notes_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "deadlines" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "notes_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "time_entries" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "notes_emailThreadId_fkey" FOREIGN KEY ("emailThreadId") REFERENCES "email_threads" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "notes_messengerItemId_fkey" FOREIGN KEY ("messengerItemId") REFERENCES "messenger_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_notes" ("authorId", "calendarEventId", "content", "createdAt", "deadlineId", "id", "isPinned", "matterId", "parentNoteId", "taskId", "timeEntryId", "type", "updatedAt") SELECT "authorId", "calendarEventId", "content", "createdAt", "deadlineId", "id", "isPinned", "matterId", "parentNoteId", "taskId", "timeEntryId", "type", "updatedAt" FROM "notes";
DROP TABLE "notes";
ALTER TABLE "new_notes" RENAME TO "notes";
CREATE INDEX "notes_matterId_idx" ON "notes"("matterId");
CREATE INDEX "notes_parentNoteId_idx" ON "notes"("parentNoteId");
CREATE INDEX "notes_calendarEventId_idx" ON "notes"("calendarEventId");
CREATE INDEX "notes_taskId_idx" ON "notes"("taskId");
CREATE INDEX "notes_deadlineId_idx" ON "notes"("deadlineId");
CREATE INDEX "notes_timeEntryId_idx" ON "notes"("timeEntryId");
CREATE INDEX "notes_emailThreadId_idx" ON "notes"("emailThreadId");
CREATE INDEX "notes_messengerItemId_idx" ON "notes"("messengerItemId");
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
    CONSTRAINT "tasks_messengerItemId_fkey" FOREIGN KEY ("messengerItemId") REFERENCES "messenger_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_tasks" ("completedAt", "createdAt", "deadlineId", "description", "dueDate", "id", "matterId", "noteId", "ownerId", "priority", "sortOrder", "status", "title", "updatedAt") SELECT "completedAt", "createdAt", "deadlineId", "description", "dueDate", "id", "matterId", "noteId", "ownerId", "priority", "sortOrder", "status", "title", "updatedAt" FROM "tasks";
DROP TABLE "tasks";
ALTER TABLE "new_tasks" RENAME TO "tasks";
CREATE INDEX "tasks_matterId_idx" ON "tasks"("matterId");
CREATE INDEX "tasks_status_idx" ON "tasks"("status");
CREATE INDEX "tasks_ownerId_idx" ON "tasks"("ownerId");
CREATE INDEX "tasks_noteId_idx" ON "tasks"("noteId");
CREATE INDEX "tasks_emailThreadId_idx" ON "tasks"("emailThreadId");
CREATE INDEX "tasks_messengerItemId_idx" ON "tasks"("messengerItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
