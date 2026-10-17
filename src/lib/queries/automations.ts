/**
 * Automations reads (ADR-019) — the firm's deadline rules, task
 * lists, and AutoApply defaults, shaped for the settings library and
 * the matter Apply dialogs.
 */

import { prisma } from "@/lib/prisma";
import { ruleSummary } from "@/lib/automations/deadline-plan";

export type DeadlineRuleRow = {
  id: string;
  title: string;
  kind: string;
  anchor: string;
  anchorRuleId: string | null;
  anchorRuleTitle: string | null;
  anchorLabel: string | null;
  offsetDays: number;
  offsetUnit: string;
  sourceRef: string | null;
  description: string | null;
  isActive: boolean;
  summary: string;
  dependentCount: number;
};

export type TaskListRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  items: {
    title: string;
    description: string | null;
    priority: string;
    assignTo: string;
    dueOffsetDays: number | null;
  }[];
};

export type AutoApplyRow = {
  id: string;
  trigger: string;
  practiceAreaId: string | null;
  practiceAreaName: string | null;
  targetKind: "rule" | "list";
  /** DeadlineRule or TaskList id (per targetKind). */
  targetId: string;
  targetName: string;
  targetActive: boolean;
};

export async function listDeadlineRules(opts: { activeOnly?: boolean } = {}): Promise<DeadlineRuleRow[]> {
  const rules = await prisma.deadlineRule.findMany({
    where: opts.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      anchorRule: { select: { title: true } },
      _count: { select: { dependents: true } },
    },
  });
  return rules.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    anchor: r.anchor,
    anchorRuleId: r.anchorRuleId,
    anchorRuleTitle: r.anchorRule?.title ?? null,
    anchorLabel: r.anchorLabel,
    offsetDays: r.offsetDays,
    offsetUnit: r.offsetUnit,
    sourceRef: r.sourceRef,
    description: r.description,
    isActive: r.isActive,
    summary: ruleSummary({ ...r, anchorRuleTitle: r.anchorRule?.title }),
    dependentCount: r._count.dependents,
  }));
}

export async function listTaskLists(opts: { activeOnly?: boolean } = {}): Promise<TaskListRow[]> {
  const lists = await prisma.taskList.findMany({
    where: opts.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { title: true, description: true, priority: true, assignTo: true, dueOffsetDays: true },
      },
    },
  });
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    isActive: l.isActive,
    items: l.items,
  }));
}

export async function listAutoApplies(): Promise<AutoApplyRow[]> {
  const rows = await prisma.autoApply.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      practiceArea: { select: { name: true } },
      deadlineRule: { select: { title: true, isActive: true } },
      taskList: { select: { name: true, isActive: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    practiceAreaId: r.practiceAreaId,
    practiceAreaName: r.practiceArea?.name ?? null,
    targetKind: r.deadlineRule ? "rule" : "list",
    targetId: r.deadlineRuleId ?? r.taskListId ?? "",
    targetName: r.deadlineRule?.title ?? r.taskList?.name ?? "—",
    targetActive: r.deadlineRule?.isActive ?? r.taskList?.isActive ?? false,
  }));
}
