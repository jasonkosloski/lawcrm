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
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "deadlines_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "deadlines_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deadlines_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_deadlines" ("completedAt", "createdAt", "description", "dueDate", "id", "kind", "matterId", "ownerId", "sourceRef", "sourceType", "status", "title", "updatedAt") SELECT "completedAt", "createdAt", "description", "dueDate", "id", "kind", "matterId", "ownerId", "sourceRef", "sourceType", "status", "title", "updatedAt" FROM "deadlines";
DROP TABLE "deadlines";
ALTER TABLE "new_deadlines" RENAME TO "deadlines";
CREATE INDEX "deadlines_matterId_idx" ON "deadlines"("matterId");
CREATE INDEX "deadlines_dueDate_idx" ON "deadlines"("dueDate");
CREATE INDEX "deadlines_status_idx" ON "deadlines"("status");
CREATE INDEX "deadlines_noteId_idx" ON "deadlines"("noteId");
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
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tasks_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tasks_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_tasks" ("completedAt", "createdAt", "deadlineId", "description", "dueDate", "id", "matterId", "ownerId", "priority", "sortOrder", "status", "title", "updatedAt") SELECT "completedAt", "createdAt", "deadlineId", "description", "dueDate", "id", "matterId", "ownerId", "priority", "sortOrder", "status", "title", "updatedAt" FROM "tasks";
DROP TABLE "tasks";
ALTER TABLE "new_tasks" RENAME TO "tasks";
CREATE INDEX "tasks_matterId_idx" ON "tasks"("matterId");
CREATE INDEX "tasks_status_idx" ON "tasks"("status");
CREATE INDEX "tasks_ownerId_idx" ON "tasks"("ownerId");
CREATE INDEX "tasks_noteId_idx" ON "tasks"("noteId");
CREATE TABLE "new_time_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "hours" REAL NOT NULL,
    "activity" TEXT NOT NULL,
    "narrative" TEXT,
    "utbmsCode" TEXT,
    "rate" REAL,
    "amount" REAL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "noCharge" BOOLEAN NOT NULL DEFAULT false,
    "privileged" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "invoiceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "calendarEventId" TEXT,
    "noteId" TEXT,
    CONSTRAINT "time_entries_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "time_entries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "time_entries_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "calendar_events" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "time_entries_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_time_entries" ("activity", "amount", "billable", "calendarEventId", "createdAt", "date", "hours", "id", "invoiceId", "matterId", "narrative", "noCharge", "privileged", "rate", "source", "sourceRef", "status", "updatedAt", "userId", "utbmsCode") SELECT "activity", "amount", "billable", "calendarEventId", "createdAt", "date", "hours", "id", "invoiceId", "matterId", "narrative", "noCharge", "privileged", "rate", "source", "sourceRef", "status", "updatedAt", "userId", "utbmsCode" FROM "time_entries";
DROP TABLE "time_entries";
ALTER TABLE "new_time_entries" RENAME TO "time_entries";
CREATE INDEX "time_entries_matterId_idx" ON "time_entries"("matterId");
CREATE INDEX "time_entries_userId_idx" ON "time_entries"("userId");
CREATE INDEX "time_entries_date_idx" ON "time_entries"("date");
CREATE INDEX "time_entries_status_idx" ON "time_entries"("status");
CREATE INDEX "time_entries_calendarEventId_idx" ON "time_entries"("calendarEventId");
CREATE INDEX "time_entries_noteId_idx" ON "time_entries"("noteId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
