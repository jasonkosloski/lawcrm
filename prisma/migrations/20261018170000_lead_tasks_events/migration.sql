-- Intake tasks and events: a Task / CalendarEvent may belong to a Lead
-- (AT MOST ONE of matterId, leadId; app-enforced). Lead conversion
-- re-homes them onto the new matter.

-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "leadId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "leadId" TEXT;

-- CreateIndex
CREATE INDEX "calendar_events_leadId_idx" ON "calendar_events"("leadId");

-- CreateIndex
CREATE INDEX "tasks_leadId_idx" ON "tasks"("leadId");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

