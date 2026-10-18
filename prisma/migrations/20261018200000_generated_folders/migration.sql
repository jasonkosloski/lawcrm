-- AlterTable
ALTER TABLE "document_folders" ADD COLUMN     "recordsRequestId" TEXT,
ADD COLUMN     "systemKind" TEXT;

-- CreateIndex
CREATE INDEX "document_folders_recordsRequestId_idx" ON "document_folders"("recordsRequestId");

-- AddForeignKey
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_recordsRequestId_fkey" FOREIGN KEY ("recordsRequestId") REFERENCES "records_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: mark the records-request folders created before this change.
-- Idempotent (every UPDATE only touches rows whose systemKind is NULL).
-- The statements between the markers are run by
-- src/lib/records-requests/folder-backfill.test.ts, split on a semicolon
-- followed by a newline, so keep comments free of that sequence.
-- BACKFILL BEGIN

-- 1. "Records Requests" directly under a root "Investigation" folder, same scope.
UPDATE "document_folders" AS rr
SET "systemKind" = 'records_root'
FROM "document_folders" AS inv
WHERE rr."systemKind" IS NULL
  AND lower(rr."name") = 'records requests'
  AND rr."parentId" = inv."id"
  AND inv."parentId" IS NULL
  AND lower(inv."name") = 'investigation'
  AND inv."matterId" IS NOT DISTINCT FROM rr."matterId"
  AND inv."leadId" IS NOT DISTINCT FROM rr."leadId";

-- 2. Each child of a marked root owned by the request with the most tagged
-- documents in it or its direct subfolders (ties go to the earliest request).
-- A child with no tagged documents is left alone.
UPDATE "document_folders" AS c
SET "systemKind" = 'records_request', "recordsRequestId" = t."rid"
FROM (
  SELECT DISTINCT ON (c2."id") c2."id" AS "cid", d."recordsRequestId" AS "rid"
  FROM "document_folders" c2
  JOIN "document_folders" r ON r."id" = c2."parentId" AND r."systemKind" = 'records_root'
  JOIN "document_folders" f ON f."id" = c2."id" OR f."parentId" = c2."id"
  JOIN "documents" d ON d."folderId" = f."id" AND d."recordsRequestId" IS NOT NULL
  JOIN "records_requests" rq ON rq."id" = d."recordsRequestId"
  GROUP BY c2."id", d."recordsRequestId", rq."createdAt"
  ORDER BY c2."id", count(*) DESC, rq."createdAt" ASC, d."recordsRequestId" ASC
) AS t
WHERE c."id" = t."cid" AND c."systemKind" IS NULL;

-- 3. Role subfolders of a marked request folder.
UPDATE "document_folders" AS s
SET "systemKind" = CASE lower(s."name")
      WHEN 'request documents' THEN 'records_request_docs'
      ELSE 'records_responsive_docs'
    END,
    "recordsRequestId" = p."recordsRequestId"
FROM "document_folders" AS p
WHERE s."systemKind" IS NULL
  AND s."parentId" = p."id"
  AND p."systemKind" = 'records_request'
  AND lower(s."name") IN ('request documents', 'responsive documents');

-- BACKFILL END
