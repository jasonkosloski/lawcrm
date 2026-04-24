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
    "statuteOfLimitationsDate" DATETIME,
    "statuteOfLimitationsSatisfied" BOOLEAN NOT NULL DEFAULT false,
    "statuteOfLimitationsSatisfiedAt" DATETIME,
    "statuteOfLimitationsNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "clientId" TEXT,
    "opposingParty" TEXT,
    "opposingFirm" TEXT,
    CONSTRAINT "matters_practiceAreaId_fkey" FOREIGN KEY ("practiceAreaId") REFERENCES "practice_areas" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "matters_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "matter_stages" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "matters_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_matters" ("caseNumber", "clientId", "color", "court", "createdAt", "description", "feeStructure", "filedDate", "id", "isArchived", "name", "opposingFirm", "opposingParty", "practiceAreaId", "stageId", "trialDate", "trustBalance", "updatedAt", "wipAmount") SELECT "caseNumber", "clientId", "color", "court", "createdAt", "description", "feeStructure", "filedDate", "id", "isArchived", "name", "opposingFirm", "opposingParty", "practiceAreaId", "stageId", "trialDate", "trustBalance", "updatedAt", "wipAmount" FROM "matters";
DROP TABLE "matters";
ALTER TABLE "new_matters" RENAME TO "matters";
CREATE INDEX "matters_stageId_idx" ON "matters"("stageId");
CREATE INDEX "matters_practiceAreaId_idx" ON "matters"("practiceAreaId");
CREATE INDEX "matters_clientId_idx" ON "matters"("clientId");
CREATE TABLE "new_practice_areas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2563a8',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hasStatuteOfLimitations" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_practice_areas" ("color", "createdAt", "id", "isActive", "label", "name", "order", "updatedAt") SELECT "color", "createdAt", "id", "isActive", "label", "name", "order", "updatedAt" FROM "practice_areas";
DROP TABLE "practice_areas";
ALTER TABLE "new_practice_areas" RENAME TO "practice_areas";
CREATE UNIQUE INDEX "practice_areas_name_key" ON "practice_areas"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
