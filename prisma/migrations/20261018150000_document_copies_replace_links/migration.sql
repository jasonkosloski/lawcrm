-- "Also file in" links become independent copies (ADR-043, revised):
-- each link turns into its own Document row sharing the stored file,
-- in the link's folder. Copies are standalone (not under any email).
INSERT INTO "documents" (
  "id", "matterId", "name", "category", "source", "fileUrl", "contentType",
  "fileSize", "status", "uploadedBy", "folderId", "createdAt", "updatedAt"
)
SELECT
  'c' || substr(md5(l."id" || random()::text || clock_timestamp()::text), 1, 24),
  d."matterId", d."name", d."category", d."source", d."fileUrl", d."contentType",
  d."fileSize", d."status", COALESCE(l."createdById", d."uploadedBy"), l."folderId",
  l."createdAt", CURRENT_TIMESTAMP
FROM "document_links" l
JOIN "documents" d ON d."id" = l."documentId";

-- DropForeignKey
ALTER TABLE "document_links" DROP CONSTRAINT "document_links_documentId_fkey";

-- DropForeignKey
ALTER TABLE "document_links" DROP CONSTRAINT "document_links_folderId_fkey";

-- DropForeignKey
ALTER TABLE "document_links" DROP CONSTRAINT "document_links_matterId_fkey";

-- DropTable
DROP TABLE "document_links";

