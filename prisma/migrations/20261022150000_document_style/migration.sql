-- CreateTable
CREATE TABLE "document_styles" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "fontKey" TEXT NOT NULL DEFAULT 'times',
    "fontSizeHalfPt" INTEGER NOT NULL DEFAULT 24,
    "lineSpacing" TEXT NOT NULL DEFAULT 'single',
    "spaceAfterPt" INTEGER NOT NULL DEFAULT 12,
    "marginTopIn" DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    "marginRightIn" DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    "marginBottomIn" DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    "marginLeftIn" DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    "letterheadBlockId" TEXT,
    "logoPosition" TEXT NOT NULL DEFAULT 'none',
    "logoKey" TEXT,
    "logoContentType" TEXT,
    "continuationBlockId" TEXT,
    "pageNumbers" TEXT NOT NULL DEFAULT 'bottom_center',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_styles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_styles_firmId_key" ON "document_styles"("firmId");

-- AddForeignKey
ALTER TABLE "document_styles" ADD CONSTRAINT "document_styles_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_styles" ADD CONSTRAINT "document_styles_letterheadBlockId_fkey" FOREIGN KEY ("letterheadBlockId") REFERENCES "template_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_styles" ADD CONSTRAINT "document_styles_continuationBlockId_fkey" FOREIGN KEY ("continuationBlockId") REFERENCES "template_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed the continuation header block: client name and date, which every
-- matter letter has (recipient would print a placeholder on letters
-- without one). Idempotent; a bare ON CONFLICT also skips the seed when a
-- user already made a block keyed 'continuation'. The style row itself is
-- created by the app on first read.
INSERT INTO "template_blocks" ("id", "key", "name", "description", "content", "updatedAt")
VALUES ('tplblock_continuation', 'continuation', 'Continuation header', 'Header on pages 2 and later: client name and date.', '{"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"field","attrs":{"path":"client.name","format":null}},{"type":"text","text":" · "},{"type":"field","attrs":{"path":"today","format":"long"}}]}]}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Data only: the new firm.edit_document_style permission, granted to every
-- role that can already edit the firm profile. Admins bypass the matrix.
-- Idempotent.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", 'firm.edit_document_style'
FROM "role_permissions"
WHERE "permission" = 'firm.edit_info'
ON CONFLICT ("roleId", "permission") DO NOTHING;
