-- CreateTable
CREATE TABLE "firms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "ein" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "establishedAt" DATETIME,
    "logoUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT,
    "name" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "phone" TEXT,
    "barNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "firmId" TEXT,
    "dashboardPrefs" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "users_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_users" ("avatarUrl", "barNumber", "createdAt", "dashboardPrefs", "email", "emailVerified", "id", "image", "initials", "isActive", "name", "passwordHash", "phone", "role", "updatedAt") SELECT "avatarUrl", "barNumber", "createdAt", "dashboardPrefs", "email", "emailVerified", "id", "image", "initials", "isActive", "name", "passwordHash", "phone", "role", "updatedAt" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_firmId_idx" ON "users"("firmId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
