
-- AlterTable
ALTER TABLE "document_templates" ADD COLUMN     "appliesTo" TEXT NOT NULL DEFAULT 'matter',
ADD COLUMN     "content" JSONB,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'letter',
ADD COLUMN     "subject" JSONB,
ALTER COLUMN "body" DROP NOT NULL;

-- Backfill: before this migration lead generation offered every template
-- (matter.* fields rendered "not on file"). Keep legacy templates available
-- on leads unless they reference {{matter.*}} fields.
UPDATE "document_templates" SET "appliesTo" = 'both'
WHERE "content" IS NULL AND ("body" IS NULL OR "body" !~ '\{\{\s*matter\.');

-- CreateTable
CREATE TABLE "template_blocks" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "content" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "template_blocks_key_key" ON "template_blocks"("key");

-- AddForeignKey
ALTER TABLE "template_blocks" ADD CONSTRAINT "template_blocks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the two default firm blocks (idempotent).
INSERT INTO "template_blocks" ("id", "key", "name", "description", "content", "updatedAt")
VALUES ('tplblock_letterhead', 'letterhead', 'Letterhead', 'Firm name and contact line, centered.', '{"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":"center"},"content":[{"type":"field","attrs":{"path":"firm.name","format":null},"marks":[{"type":"bold"}]}]},{"type":"paragraph","attrs":{"textAlign":"center"},"content":[{"type":"field","attrs":{"path":"firm.address","format":"one_line"}}]},{"type":"paragraph","attrs":{"textAlign":"center"},"content":[{"type":"field","attrs":{"path":"firm.phone","format":null}},{"type":"text","text":" \u00b7 "},{"type":"field","attrs":{"path":"firm.email","format":null}}]}]}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "template_blocks" ("id", "key", "name", "description", "content", "updatedAt")
VALUES ('tplblock_signature', 'signature', 'Signature', 'Closing and signer block.', '{"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Sincerely,"}]},{"type":"paragraph","attrs":{"textAlign":null}},{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"field","attrs":{"path":"signer.name","format":null}}]},{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"field","attrs":{"path":"signer.title","format":null}}]},{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Bar No. "},{"type":"field","attrs":{"path":"signer.barNumber","format":null}}]},{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"field","attrs":{"path":"firm.name","format":null}}]}]}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
