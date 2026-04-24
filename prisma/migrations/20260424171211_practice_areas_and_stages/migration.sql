/*
  Warnings:

  - You are about to drop the column `area` on the `matters` table. All the data in the column will be lost.
  - You are about to drop the column `stage` on the `matters` table. All the data in the column will be lost.
  - Added the required column `practiceAreaId` to the `matters` table without a default value. This is not possible if the table is not empty.
  - Added the required column `stageId` to the `matters` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "practice_areas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2563a8',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "matter_stages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceAreaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "matter_stages_practiceAreaId_fkey" FOREIGN KEY ("practiceAreaId") REFERENCES "practice_areas" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_matters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "caseNumber" TEXT,
    "practiceAreaId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
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
    CONSTRAINT "matters_practiceAreaId_fkey" FOREIGN KEY ("practiceAreaId") REFERENCES "practice_areas" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "matters_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "matter_stages" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "matters_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_matters" ("caseNumber", "clientId", "color", "court", "createdAt", "description", "feeStructure", "filedDate", "id", "isArchived", "name", "opposingFirm", "opposingParty", "trialDate", "trustBalance", "updatedAt", "wipAmount") SELECT "caseNumber", "clientId", "color", "court", "createdAt", "description", "feeStructure", "filedDate", "id", "isArchived", "name", "opposingFirm", "opposingParty", "trialDate", "trustBalance", "updatedAt", "wipAmount" FROM "matters";
DROP TABLE "matters";
ALTER TABLE "new_matters" RENAME TO "matters";
CREATE INDEX "matters_stageId_idx" ON "matters"("stageId");
CREATE INDEX "matters_practiceAreaId_idx" ON "matters"("practiceAreaId");
CREATE INDEX "matters_clientId_idx" ON "matters"("clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "practice_areas_name_key" ON "practice_areas"("name");

-- CreateIndex
CREATE INDEX "matter_stages_practiceAreaId_order_idx" ON "matter_stages"("practiceAreaId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "matter_stages_practiceAreaId_name_key" ON "matter_stages"("practiceAreaId", "name");
