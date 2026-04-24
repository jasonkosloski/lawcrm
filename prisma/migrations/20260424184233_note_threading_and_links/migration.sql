-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "notes_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "notes_parentNoteId_fkey" FOREIGN KEY ("parentNoteId") REFERENCES "notes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notes_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "calendar_events" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "notes_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "notes_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "deadlines" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "notes_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "time_entries" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_notes" ("authorId", "content", "createdAt", "id", "isPinned", "matterId", "type", "updatedAt") SELECT "authorId", "content", "createdAt", "id", "isPinned", "matterId", "type", "updatedAt" FROM "notes";
DROP TABLE "notes";
ALTER TABLE "new_notes" RENAME TO "notes";
CREATE INDEX "notes_matterId_idx" ON "notes"("matterId");
CREATE INDEX "notes_parentNoteId_idx" ON "notes"("parentNoteId");
CREATE INDEX "notes_calendarEventId_idx" ON "notes"("calendarEventId");
CREATE INDEX "notes_taskId_idx" ON "notes"("taskId");
CREATE INDEX "notes_deadlineId_idx" ON "notes"("deadlineId");
CREATE INDEX "notes_timeEntryId_idx" ON "notes"("timeEntryId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
