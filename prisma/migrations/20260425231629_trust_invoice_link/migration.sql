-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_trust_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matterId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "date" DATETIME NOT NULL,
    "createdBy" TEXT,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trust_transactions_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "trust_transactions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_trust_transactions" ("amount", "createdAt", "createdBy", "date", "description", "id", "matterId", "reconciled", "reference", "type") SELECT "amount", "createdAt", "createdBy", "date", "description", "id", "matterId", "reconciled", "reference", "type" FROM "trust_transactions";
DROP TABLE "trust_transactions";
ALTER TABLE "new_trust_transactions" RENAME TO "trust_transactions";
CREATE INDEX "trust_transactions_matterId_idx" ON "trust_transactions"("matterId");
CREATE INDEX "trust_transactions_date_idx" ON "trust_transactions"("date");
CREATE INDEX "trust_transactions_invoiceId_idx" ON "trust_transactions"("invoiceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
