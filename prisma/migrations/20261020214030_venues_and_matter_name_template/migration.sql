-- AlterTable
ALTER TABLE "firms" ADD COLUMN     "matterNameTemplate" TEXT NOT NULL DEFAULT '{client_last}, {client_first} - {case_number} - {location}';

-- AlterTable
ALTER TABLE "matters" ADD COLUMN     "venueId" TEXT;

-- AlterTable
ALTER TABLE "practice_areas" ADD COLUMN     "matterNameTemplate" TEXT,
ADD COLUMN     "requiredMatterFields" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "venues" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "city" TEXT,
    "county" TEXT,
    "state" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "venues_nameKey_key" ON "venues"("nameKey");

-- CreateIndex
CREATE INDEX "matters_venueId_idx" ON "matters"("venueId");

-- AddForeignKey
ALTER TABLE "matters" ADD CONSTRAINT "matters_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grant venues.add to every role that can create matters, so intake can
-- add a venue inline. Admins bypass the matrix.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", 'venues.add' FROM "role_permissions"
WHERE "permission" = 'matters.create'
ON CONFLICT ("roleId", "permission") DO NOTHING;
