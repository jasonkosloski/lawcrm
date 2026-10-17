/**
 * Apply deadline rules / task lists to a matter — server-only DB layer
 * (ADR-019). Pure date logic lives in `deadline-plan.ts`.
 *
 * Every function takes a transaction client so callers compose it
 * into their own transaction (matter create, lead conversion, the
 * manual-apply actions). Activity logging is the CALLER's job, after
 * commit — `logActivity` is fire-and-forget and must never sit
 * inside a transaction. `describeApplication` builds the line.
 *
 * Two modes, chosen by the caller:
 *   - manual (a person clicked Apply): duplicates are reported back
 *     for confirmation (onDuplicate "report") or created anyway
 *     ("create"); rules that can't be dated are reported back so
 *     the UI can ask for a date (onUnplanned "report").
 *   - automatic (AutoApply defaults on matter create): duplicates
 *     are skipped (idempotent) and undatable rules become a
 *     "Set date: …" task on the matter (onUnplanned "task") — never
 *     silently dropped.
 */

import type { Tx } from "@/lib/prisma";
import { parseDateOnly, todayKey as todayKeyInTz } from "@/lib/format-date";
import {
  addDaysToKey,
  deadlineDateFromKey,
  deadlineKindForRule,
  describeOffset,
  planDeadlineRules,
  ruleAnchorText,
  unplannedReasonText,
  type DeadlineRuleAnchor,
  type PlannableRule,
  type UnplannedRule,
} from "./deadline-plan";

export const AUTOMATION_SOURCE_TYPE = "deadline_rule";
export const AUTO_APPLY_TRIGGERS = ["matter_created"] as const;
export type AutoApplyTrigger = (typeof AUTO_APPLY_TRIGGERS)[number];

/** The matter's active lead attorney, if any. */
async function matterLeadId(tx: Tx, matterId: string): Promise<string | null> {
  const lead = await tx.matterTeamMember.findFirst({
    where: { matterId, role: "lead", removedAt: null },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return lead?.userId ?? null;
}

// ── Deadline rules ─────────────────────────────────────────────────

export type ApplyDeadlineRulesResult = {
  created: { ruleId: string; title: string; deadlineId: string; dueKey: string }[];
  /** Rules that already have a deadline on this matter. */
  duplicates: { ruleId: string; title: string }[];
  /** Rules that couldn't be dated (reported, or turned into tasks). */
  unplanned: {
    ruleId: string;
    title: string;
    reason: string;
    /** Machine-readable reason (see `UnplannedRule`). */
    code: UnplannedRule["reason"];
    taskId?: string;
  }[];
};

export async function applyDeadlineRules(
  tx: Tx,
  input: {
    matterId: string;
    ruleIds: readonly string[];
    tz: string;
    /** Day keys by rule id — "prompt" answers / fallback anchors. */
    anchorDates?: Readonly<Record<string, string>>;
    onDuplicate: "report" | "create" | "skip";
    onUnplanned: "report" | "task";
  }
): Promise<ApplyDeadlineRulesResult> {
  const result: ApplyDeadlineRulesResult = { created: [], duplicates: [], unplanned: [] };
  if (input.ruleIds.length === 0) return result;

  const [matter, rules, existing] = await Promise.all([
    tx.matter.findUniqueOrThrow({
      where: { id: input.matterId },
      select: { incidentDate: true, createdAt: true },
    }),
    tx.deadlineRule.findMany({
      where: { id: { in: [...input.ruleIds] }, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { anchorRule: { select: { title: true } } },
    }),
    tx.deadline.findMany({
      where: { matterId: input.matterId, deadlineRuleId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { deadlineRuleId: true, dueDate: true },
    }),
  ]);

  // Newest generated deadline per rule — the anchor for dependents.
  const existingByRule = new Map<string, Date>();
  for (const d of existing) {
    if (d.deadlineRuleId && !existingByRule.has(d.deadlineRuleId)) {
      existingByRule.set(d.deadlineRuleId, d.dueDate);
    }
  }

  const duplicateIds = new Set(rules.filter((r) => existingByRule.has(r.id)).map((r) => r.id));
  result.duplicates = rules
    .filter((r) => duplicateIds.has(r.id))
    .map((r) => ({ ruleId: r.id, title: r.title }));
  if (input.onDuplicate === "report" && result.duplicates.length > 0) {
    return result; // nothing written — caller asks for confirmation
  }
  const toPlan = rules.filter(
    (r) => input.onDuplicate === "create" || !duplicateIds.has(r.id)
  );

  const plannable: PlannableRule[] = toPlan.map((r) => ({
    id: r.id,
    title: r.title,
    anchor: r.anchor as DeadlineRuleAnchor,
    anchorRuleId: r.anchorRuleId,
    anchorLabel: r.anchorLabel,
    offsetDays: r.offsetDays,
    offsetUnit: r.offsetUnit,
  }));
  const plan = planDeadlineRules(plannable, {
    incidentDate: matter.incidentDate,
    matterOpenedAt: matter.createdAt,
    tz: input.tz,
    existingRuleDeadlines: existingByRule,
    anchorDates: new Map(Object.entries(input.anchorDates ?? {})),
  });

  const byId = new Map(toPlan.map((r) => [r.id, r]));
  const leadId = await matterLeadId(tx, input.matterId);

  for (const p of plan.planned) {
    const r = byId.get(p.rule.id)!;
    const anchorText = ruleAnchorText({
      anchor: r.anchor,
      anchorLabel: r.anchorLabel,
      anchorRuleTitle: r.anchorRule?.title,
    });
    const deadline = await tx.deadline.create({
      data: {
        matterId: input.matterId,
        title: r.title,
        dueDate: deadlineDateFromKey(p.dueKey),
        kind: deadlineKindForRule(r.kind),
        sourceType: AUTOMATION_SOURCE_TYPE,
        sourceRef: r.sourceRef,
        description: [
          r.description,
          `Auto-calculated: ${describeOffset(r.offsetDays, r.offsetUnit, anchorText)} (${p.anchorKey}).`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        ownerId: leadId,
        status: "open",
        deadlineRuleId: r.id,
      },
      select: { id: true },
    });
    result.created.push({ ruleId: r.id, title: r.title, deadlineId: deadline.id, dueKey: p.dueKey });
  }

  for (const u of plan.unplanned) {
    const r = byId.get(u.rule.id)!;
    const reason = unplannedReasonText(u, r.anchorRule?.title);
    let taskId: string | undefined;
    if (input.onUnplanned === "task") {
      const task = await tx.task.create({
        data: {
          matterId: input.matterId,
          title: u.reason === "out_of_range" ? `Fix rule: ${r.title}` : `Set date: ${r.title}`,
          description:
            u.reason === "out_of_range"
              ? // No date the user could type fixes this; the rule's offset is the problem.
                `The "${r.title}" deadline rule couldn't be applied automatically because ${reason}. ` +
                `Fix the rule's offset in Settings > Automations, then apply it manually from the Deadlines tab ` +
                `(${describeOffset(r.offsetDays, r.offsetUnit, "the anchor date")}).`
              : `The "${r.title}" deadline rule couldn't be applied automatically because ${reason}. ` +
                `Once the date is known, use "Apply deadline rule" on the Deadlines tab ` +
                `(${describeOffset(r.offsetDays, r.offsetUnit, "the anchor date")}).`,
          priority: r.kind === "critical" ? "urgent" : "high",
          ownerId: leadId,
          status: "open",
        },
        select: { id: true },
      });
      taskId = task.id;
    }
    result.unplanned.push({ ruleId: r.id, title: r.title, reason, code: u.reason, taskId });
  }

  return result;
}

// ── Task lists ─────────────────────────────────────────────────────

export type ApplyTaskListResult = {
  listName: string;
  createdTaskIds: string[];
  /** The list was already applied to this matter (and not re-applied). */
  duplicate: boolean;
};

export async function applyTaskList(
  tx: Tx,
  input: {
    matterId: string;
    taskListId: string;
    tz: string;
    now?: Date;
    onDuplicate: "report" | "create" | "skip";
  }
): Promise<ApplyTaskListResult> {
  const list = await tx.taskList.findFirst({
    where: { id: input.taskListId, isActive: true },
    include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  if (!list) return { listName: "", createdTaskIds: [], duplicate: false };

  const alreadyApplied =
    (await tx.task.count({
      where: { matterId: input.matterId, taskListId: list.id },
    })) > 0;
  if (alreadyApplied && input.onDuplicate !== "create") {
    return { listName: list.name, createdTaskIds: [], duplicate: true };
  }

  const leadId = await matterLeadId(tx, input.matterId);
  const todayKey = todayKeyInTz(input.tz, input.now);
  // Append after whatever the matter already has: hand-made tasks sit
  // at sortOrder 0, so numbering from 0 would interleave the list with
  // them (and with an earlier application of the same list).
  const { _max } = await tx.task.aggregate({
    where: { matterId: input.matterId },
    _max: { sortOrder: true },
  });
  const baseOrder = (_max.sortOrder ?? -1) + 1;
  // One round trip for the whole list (this runs inside the
  // matter-creating transaction in auto mode). createManyAndReturn
  // returns rows in insertion order, which `createdTaskIds` relies on.
  const created = await tx.task.createManyAndReturn({
    data: list.items.map((item, i) => ({
      matterId: input.matterId,
      title: item.title,
      description: item.description,
      priority: item.priority,
      status: "open",
      ownerId: item.assignTo === "lead" ? leadId : null,
      dueDate:
        item.dueOffsetDays === null
          ? null
          : parseDateOnly(addDaysToKey(todayKey, item.dueOffsetDays)),
      sortOrder: baseOrder + i,
      taskListId: list.id,
    })),
    select: { id: true },
  });
  const createdTaskIds = created.map((t) => t.id);
  return { listName: list.name, createdTaskIds, duplicate: alreadyApplied };
}

// ── Defaults (AutoApply) ───────────────────────────────────────────

export type MatterDefaultsResult = {
  deadlines: ApplyDeadlineRulesResult;
  taskLists: ApplyTaskListResult[];
};

/**
 * Apply every AutoApply default for `trigger` that targets this
 * matter's practice area (or all areas). Idempotent: rules/lists
 * already on the matter are skipped. Safe to call inside the
 * matter-creating transaction.
 */
export async function applyAutoDefaults(
  tx: Tx,
  input: {
    matterId: string;
    practiceAreaId: string;
    trigger: AutoApplyTrigger;
    tz: string;
    now?: Date;
  }
): Promise<MatterDefaultsResult> {
  const defaults = await tx.autoApply.findMany({
    where: {
      trigger: input.trigger,
      OR: [{ practiceAreaId: input.practiceAreaId }, { practiceAreaId: null }],
    },
    select: { deadlineRuleId: true, taskListId: true },
  });
  const ruleIds = [...new Set(defaults.flatMap((d) => (d.deadlineRuleId ? [d.deadlineRuleId] : [])))];
  const listIds = [...new Set(defaults.flatMap((d) => (d.taskListId ? [d.taskListId] : [])))];

  const deadlines = await applyDeadlineRules(tx, {
    matterId: input.matterId,
    ruleIds,
    tz: input.tz,
    onDuplicate: "skip",
    onUnplanned: "task",
  });
  const taskLists: ApplyTaskListResult[] = [];
  for (const taskListId of listIds) {
    const r = await applyTaskList(tx, {
      matterId: input.matterId,
      taskListId,
      tz: input.tz,
      now: input.now,
      onDuplicate: "skip",
    });
    if (r.createdTaskIds.length > 0) taskLists.push(r);
  }
  return { deadlines, taskLists };
}

/** One activity-log line for an automatic application, or null when
 *  nothing happened (no defaults configured). */
export function describeDefaults(r: MatterDefaultsResult): string | null {
  const parts: string[] = [];
  const d = r.deadlines.created.length;
  if (d > 0) parts.push(`${d} deadline${d === 1 ? "" : "s"}`);
  const t = r.taskLists.reduce((n, l) => n + l.createdTaskIds.length, 0);
  if (t > 0) {
    const names = r.taskLists.map((l) => l.listName).join(", ");
    parts.push(`${t} task${t === 1 ? "" : "s"} (${names})`);
  }
  const u = r.deadlines.unplanned.length;
  if (u > 0) parts.push(`${u} "set date" task${u === 1 ? "" : "s"}`);
  return parts.length ? `Automatic defaults applied: ${parts.join(", ")}` : null;
}
