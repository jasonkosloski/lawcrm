-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_matter_contacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matterId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "role" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "matter_contacts_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "matter_contacts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_matter_contacts" ("contactId", "createdAt", "id", "matterId", "notes", "role") SELECT "contactId", "createdAt", "id", "matterId", "notes", "role" FROM "matter_contacts";
DROP TABLE "matter_contacts";
ALTER TABLE "new_matter_contacts" RENAME TO "matter_contacts";
CREATE INDEX "matter_contacts_category_idx" ON "matter_contacts"("category");
CREATE UNIQUE INDEX "matter_contacts_matterId_contactId_category_key" ON "matter_contacts"("matterId", "contactId", "category");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
