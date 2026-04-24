/*
  Warnings:

  - You are about to drop the column `isPinned` on the `matters` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "user_matter_pins" (
    "userId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "matterId"),
    CONSTRAINT "user_matter_pins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_matter_pins_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_matters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "caseNumber" TEXT,
    "area" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'Intake',
    "court" TEXT,
    "filedDate" DATETIME,
    "trialDate" DATETIME,
    "feeStructure" TEXT NOT NULL DEFAULT 'contingent',
    "trustBalance" REAL NOT NULL DEFAULT 0,
    "wipAmount" REAL NOT NULL DEFAULT 0,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2563a8',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "clientId" TEXT,
    "opposingParty" TEXT,
    "opposingFirm" TEXT,
    CONSTRAINT "matters_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_matters" ("area", "caseNumber", "clientId", "color", "court", "createdAt", "description", "feeStructure", "filedDate", "id", "isArchived", "name", "opposingFirm", "opposingParty", "stage", "trialDate", "trustBalance", "updatedAt", "wipAmount") SELECT "area", "caseNumber", "clientId", "color", "court", "createdAt", "description", "feeStructure", "filedDate", "id", "isArchived", "name", "opposingFirm", "opposingParty", "stage", "trialDate", "trustBalance", "updatedAt", "wipAmount" FROM "matters";
DROP TABLE "matters";
ALTER TABLE "new_matters" RENAME TO "matters";
CREATE INDEX "matters_stage_idx" ON "matters"("stage");
CREATE INDEX "matters_area_idx" ON "matters"("area");
CREATE INDEX "matters_clientId_idx" ON "matters"("clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "user_matter_pins_userId_idx" ON "user_matter_pins"("userId");

-- CreateIndex
CREATE INDEX "user_matter_pins_matterId_idx" ON "user_matter_pins"("matterId");
