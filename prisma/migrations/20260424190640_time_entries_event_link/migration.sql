-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "time_entries_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "time_entries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "time_entries_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "calendar_events" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_time_entries" ("activity", "amount", "billable", "createdAt", "date", "hours", "id", "invoiceId", "matterId", "narrative", "noCharge", "privileged", "rate", "source", "sourceRef", "status", "updatedAt", "userId", "utbmsCode") SELECT "activity", "amount", "billable", "createdAt", "date", "hours", "id", "invoiceId", "matterId", "narrative", "noCharge", "privileged", "rate", "source", "sourceRef", "status", "updatedAt", "userId", "utbmsCode" FROM "time_entries";
DROP TABLE "time_entries";
ALTER TABLE "new_time_entries" RENAME TO "time_entries";
CREATE INDEX "time_entries_matterId_idx" ON "time_entries"("matterId");
CREATE INDEX "time_entries_userId_idx" ON "time_entries"("userId");
CREATE INDEX "time_entries_date_idx" ON "time_entries"("date");
CREATE INDEX "time_entries_status_idx" ON "time_entries"("status");
CREATE INDEX "time_entries_calendarEventId_idx" ON "time_entries"("calendarEventId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
