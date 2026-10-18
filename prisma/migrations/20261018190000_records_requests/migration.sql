-- Records requests: track records requests (HIPAA, CORA, police, employment)
-- on matters and intake leads. New tables records_request_types,
-- records_requests, records_request_follow_ups; nullable links
-- documents.recordsRequestId / recordsRequestRole and tasks.recordsRequestId
-- (SetNull). Seeds four starter request types (editable or deletable; the
-- response periods are starting points, not legal advice).

-- CreateEnum
CREATE TYPE "RecordsPeriodUnit" AS ENUM ('CALENDAR_DAYS', 'BUSINESS_DAYS');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "recordsRequestId" TEXT,
ADD COLUMN     "recordsRequestRole" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "recordsRequestId" TEXT;

-- CreateTable
CREATE TABLE "records_request_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "responseAmount" INTEGER,
    "responseUnit" "RecordsPeriodUnit",
    "followUpDays" INTEGER NOT NULL DEFAULT 7,
    "defaultTemplateId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "records_request_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "records_requests" (
    "id" TEXT NOT NULL,
    "matterId" TEXT,
    "leadId" TEXT,
    "custodianContactId" TEXT NOT NULL,
    "typeId" TEXT,
    "adHocTypeName" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sentAt" TIMESTAMP(3),
    "responseDueDate" TIMESTAMP(3),
    "nextFollowUpDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "feeEstimate" DECIMAL(14,2),
    "feeAmount" DECIMAL(14,2),
    "feePaidAt" TIMESTAMP(3),
    "expenseId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "records_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "records_request_follow_ups" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "records_request_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "records_requests_expenseId_key" ON "records_requests"("expenseId");

-- CreateIndex
CREATE INDEX "records_requests_matterId_idx" ON "records_requests"("matterId");

-- CreateIndex
CREATE INDEX "records_requests_leadId_idx" ON "records_requests"("leadId");

-- CreateIndex
CREATE INDEX "records_requests_status_idx" ON "records_requests"("status");

-- CreateIndex
CREATE INDEX "records_requests_ownerId_idx" ON "records_requests"("ownerId");

-- CreateIndex
CREATE INDEX "records_requests_status_nextFollowUpDate_idx" ON "records_requests"("status", "nextFollowUpDate");

-- CreateIndex
CREATE INDEX "records_requests_status_responseDueDate_idx" ON "records_requests"("status", "responseDueDate");

-- CreateIndex
CREATE INDEX "records_request_follow_ups_requestId_idx" ON "records_request_follow_ups"("requestId");

-- CreateIndex
CREATE INDEX "documents_recordsRequestId_idx" ON "documents"("recordsRequestId");

-- CreateIndex
CREATE INDEX "tasks_recordsRequestId_idx" ON "tasks"("recordsRequestId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_recordsRequestId_fkey" FOREIGN KEY ("recordsRequestId") REFERENCES "records_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recordsRequestId_fkey" FOREIGN KEY ("recordsRequestId") REFERENCES "records_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records_request_types" ADD CONSTRAINT "records_request_types_defaultTemplateId_fkey" FOREIGN KEY ("defaultTemplateId") REFERENCES "document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records_requests" ADD CONSTRAINT "records_requests_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records_requests" ADD CONSTRAINT "records_requests_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records_requests" ADD CONSTRAINT "records_requests_custodianContactId_fkey" FOREIGN KEY ("custodianContactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records_requests" ADD CONSTRAINT "records_requests_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "records_request_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records_requests" ADD CONSTRAINT "records_requests_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records_requests" ADD CONSTRAINT "records_requests_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records_request_follow_ups" ADD CONSTRAINT "records_request_follow_ups_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "records_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records_request_follow_ups" ADD CONSTRAINT "records_request_follow_ups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Seed starter request types
INSERT INTO "records_request_types" ("id", "name", "responseAmount", "responseUnit", "followUpDays", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
  ('c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24), 'Medical (HIPAA)', 30, 'CALENDAR_DAYS', 7, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24), 'CORA', 3, 'BUSINESS_DAYS', 7, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24), 'Police report', 3, 'BUSINESS_DAYS', 7, true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24), 'Employment', 30, 'CALENDAR_DAYS', 7, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
