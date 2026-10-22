-- AlterTable
ALTER TABLE "venues" ADD COLUMN     "captionName" TEXT,
ADD COLUMN     "courtFormatId" TEXT;

-- CreateTable
CREATE TABLE "court_formats" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "courtSystem" TEXT NOT NULL DEFAULT 'state',
    "fontKey" TEXT,
    "fontSizeHalfPt" INTEGER,
    "lineSpacing" TEXT,
    "spaceAfterPt" INTEGER,
    "marginTopIn" DECIMAL(3,2),
    "marginRightIn" DECIMAL(3,2),
    "marginBottomIn" DECIMAL(3,2),
    "marginLeftIn" DECIMAL(3,2),
    "pageNumbers" TEXT,
    "paperSize" TEXT NOT NULL DEFAULT 'letter',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "court_formats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "court_format_blocks" (
    "id" TEXT NOT NULL,
    "courtFormatId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "replacementBlockId" TEXT NOT NULL,

    CONSTRAINT "court_format_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "court_formats_name_key" ON "court_formats"("name");

-- CreateIndex
CREATE INDEX "court_format_blocks_blockId_idx" ON "court_format_blocks"("blockId");

-- CreateIndex
CREATE INDEX "court_format_blocks_replacementBlockId_idx" ON "court_format_blocks"("replacementBlockId");

-- CreateIndex
CREATE UNIQUE INDEX "court_format_blocks_courtFormatId_blockId_key" ON "court_format_blocks"("courtFormatId", "blockId");

-- CreateIndex
CREATE INDEX "venues_courtFormatId_idx" ON "venues"("courtFormatId");

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_courtFormatId_fkey" FOREIGN KEY ("courtFormatId") REFERENCES "court_formats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_format_blocks" ADD CONSTRAINT "court_format_blocks_courtFormatId_fkey" FOREIGN KEY ("courtFormatId") REFERENCES "court_formats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_format_blocks" ADD CONSTRAINT "court_format_blocks_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "template_blocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_format_blocks" ADD CONSTRAINT "court_format_blocks_replacementBlockId_fkey" FOREIGN KEY ("replacementBlockId") REFERENCES "template_blocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data only: the new court_formats.add / .edit / .delete permissions,
-- granted to every role that can already edit document templates. Admins
-- bypass the matrix. Idempotent.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT rp."roleId", k."permission"
FROM "role_permissions" rp
CROSS JOIN (VALUES ('court_formats.add'), ('court_formats.edit'), ('court_formats.delete')) AS k("permission")
WHERE rp."permission" = 'documents.template.edit'
ON CONFLICT ("roleId", "permission") DO NOTHING;
