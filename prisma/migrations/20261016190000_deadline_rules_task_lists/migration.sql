-- AlterTable
ALTER TABLE "deadlines" ADD COLUMN     "deadlineRuleId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "taskListId" TEXT;

-- CreateTable
CREATE TABLE "deadline_rules" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'critical',
    "anchor" TEXT NOT NULL,
    "anchorRuleId" TEXT,
    "anchorLabel" TEXT,
    "offsetDays" INTEGER NOT NULL,
    "offsetUnit" TEXT NOT NULL DEFAULT 'days',
    "sourceRef" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deadline_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_lists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_list_items" (
    "id" TEXT NOT NULL,
    "taskListId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "assignTo" TEXT NOT NULL DEFAULT 'unassigned',
    "dueOffsetDays" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_applies" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'matter_created',
    "practiceAreaId" TEXT,
    "deadlineRuleId" TEXT,
    "taskListId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_applies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deadline_rules_anchorRuleId_idx" ON "deadline_rules"("anchorRuleId");

-- CreateIndex
CREATE INDEX "task_list_items_taskListId_idx" ON "task_list_items"("taskListId");

-- CreateIndex
CREATE INDEX "auto_applies_trigger_practiceAreaId_idx" ON "auto_applies"("trigger", "practiceAreaId");

-- CreateIndex
CREATE INDEX "deadlines_deadlineRuleId_idx" ON "deadlines"("deadlineRuleId");

-- CreateIndex
CREATE INDEX "tasks_taskListId_idx" ON "tasks"("taskListId");

-- AddForeignKey
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_deadlineRuleId_fkey" FOREIGN KEY ("deadlineRuleId") REFERENCES "deadline_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_taskListId_fkey" FOREIGN KEY ("taskListId") REFERENCES "task_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_rules" ADD CONSTRAINT "deadline_rules_anchorRuleId_fkey" FOREIGN KEY ("anchorRuleId") REFERENCES "deadline_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_list_items" ADD CONSTRAINT "task_list_items_taskListId_fkey" FOREIGN KEY ("taskListId") REFERENCES "task_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_applies" ADD CONSTRAINT "auto_applies_practiceAreaId_fkey" FOREIGN KEY ("practiceAreaId") REFERENCES "practice_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_applies" ADD CONSTRAINT "auto_applies_deadlineRuleId_fkey" FOREIGN KEY ("deadlineRuleId") REFERENCES "deadline_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_applies" ADD CONSTRAINT "auto_applies_taskListId_fkey" FOREIGN KEY ("taskListId") REFERENCES "task_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

