-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_leads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT,
    "sourceDetail" TEXT,
    "summary" TEXT,
    "location" TEXT,
    "dateOfIncident" DATETIME,
    "injuries" TEXT,
    "priorCounsel" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER,
    "liabilityAssessment" TEXT,
    "damagesAssessment" TEXT,
    "defendantAbility" TEXT,
    "statuteWindow" INTEGER,
    "conflictCheck" TEXT NOT NULL DEFAULT 'pending',
    "stage" TEXT NOT NULL DEFAULT 'new',
    "declineReason" TEXT,
    "convertedMatterId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "leads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_leads" ("conflictCheck", "convertedMatterId", "createdAt", "damagesAssessment", "dateOfIncident", "declineReason", "defendantAbility", "email", "id", "injuries", "liabilityAssessment", "location", "name", "phone", "priorCounsel", "score", "source", "sourceDetail", "stage", "statuteWindow", "summary", "updatedAt") SELECT "conflictCheck", "convertedMatterId", "createdAt", "damagesAssessment", "dateOfIncident", "declineReason", "defendantAbility", "email", "id", "injuries", "liabilityAssessment", "location", "name", "phone", "priorCounsel", "score", "source", "sourceDetail", "stage", "statuteWindow", "summary", "updatedAt" FROM "leads";
DROP TABLE "leads";
ALTER TABLE "new_leads" RENAME TO "leads";
CREATE INDEX "leads_stage_idx" ON "leads"("stage");
CREATE INDEX "leads_score_idx" ON "leads"("score");
CREATE INDEX "leads_contactId_idx" ON "leads"("contactId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
