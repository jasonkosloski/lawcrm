/**
 * Automations — server actions (ADR-019).
 *
 * Three groups:
 *   1. Library governance (Settings → Automations): CRUD for deadline
 *      rules and task lists, gated on `automations.deadline_rule.*` /
 *      `automations.task_list.*`. Firm-wide activity-log rows.
 *   2. Defaults: which rules/lists apply automatically when a matter
 *      is created (AutoApply rows), gated on `automations.defaults.*`.
 *   3. Manual apply on a matter, gated on the capability it exercises
 *      — `deadlines.create` / `tasks.create` — not on the library keys.
 *
 * The apply engine itself lives in `src/lib/automations/`.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import {
  DEADLINE_RULE_ANCHORS,
  DEADLINE_RULE_KINDS,
  MAX_OFFSET_DAYS,
  OFFSET_UNITS,
  isDayKey,
  packOffset,
  wouldCreateCycle,
} from "@/lib/automations/deadline-plan";
import {
  AUTO_APPLY_TRIGGERS,
  applyDeadlineRules,
  applyTaskList,
} from "@/lib/automations/apply";
import type {
  ApplyRuleResult,
  ApplyTaskListResult,
  AutomationFormState,
} from "@/lib/automation-form";
import { TASK_PRIORITIES } from "@/lib/constants/priority";
import { isForeignKeyViolation, isRecordNotFound } from "@/lib/prisma-errors";

const SETTINGS_PATH = "/settings/automations";

/** Serialize manual applies per matter so a double submit (or two
 *  users) can't both pass the duplicate check and both create. */
async function lockMatterForApply(
  tx: Pick<Tx, "$executeRaw">,
  matterId: string
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`automation-apply:${matterId}`}))`;
}

function fail(field: string, message: string): AutomationFormState {
  return { status: "error", errors: { [field]: [message] } };
}

// ── Deadline rules ─────────────────────────────────────────────────

const ruleSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    kind: z.enum(DEADLINE_RULE_KINDS),
    anchor: z.enum(DEADLINE_RULE_ANCHORS),
    anchorRuleId: z.string().trim().optional().or(z.literal("")),
    anchorLabel: z.string().trim().max(80).optional().or(z.literal("")),
    amount: z.coerce
      .number({ message: "Enter a number" })
      .int("Whole numbers only")
      .min(0, "Can't be negative")
      .max(MAX_OFFSET_DAYS, "That's over 100 years"),
    unit: z.enum(OFFSET_UNITS),
    direction: z.enum(["after", "before"]),
    sourceRef: z.string().trim().max(200).optional().or(z.literal("")),
    description: z.string().trim().max(4000).optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    // The cap above is on the amount; 36,500 years would still pack to
    // millions of days and overflow the calendar when applied.
    if (Math.abs(packOffset(v)) > MAX_OFFSET_DAYS) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "That's over 100 years" });
    }
    if (v.anchor === "rule" && !v.anchorRuleId) {
      ctx.addIssue({ code: "custom", path: ["anchorRuleId"], message: "Pick the rule this one counts from" });
    }
  });

type RuleInput = z.infer<typeof ruleSchema>;

/** Validate the anchor rule exists and the link wouldn't loop. */
async function checkAnchorRule(
  ruleId: string | null,
  input: RuleInput
): Promise<AutomationFormState | null> {
  if (input.anchor !== "rule") return null;
  const anchorId = input.anchorRuleId!;
  const all = await prisma.deadlineRule.findMany({
    select: { id: true, anchorRuleId: true },
  });
  if (!all.some((r) => r.id === anchorId)) {
    return fail("anchorRuleId", "That rule no longer exists");
  }
  const anchorOf = new Map(
    all.filter((r) => r.id !== ruleId).map((r) => [r.id, r.anchorRuleId])
  );
  if (wouldCreateCycle(ruleId, anchorId, anchorOf)) {
    return fail("anchorRuleId", "That would make rules count from each other in a loop");
  }
  return null;
}

function ruleData(input: RuleInput) {
  return {
    title: input.title,
    kind: input.kind,
    anchor: input.anchor,
    anchorRuleId: input.anchor === "rule" ? input.anchorRuleId! : null,
    anchorLabel: input.anchor === "prompt" ? input.anchorLabel || null : null,
    offsetDays: packOffset(input),
    offsetUnit: input.unit,
    sourceRef: input.sourceRef || null,
    description: input.description || null,
  };
}

export async function createDeadlineRule(
  _prev: AutomationFormState,
  formData: FormData
): Promise<AutomationFormState> {
  const userId = await requirePermission("automations.deadline_rule.create");
  const parsed = ruleSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { status: "error", errors: parsed.error.flatten().fieldErrors };
  const bad = await checkAnchorRule(null, parsed.data);
  if (bad) return bad;

  const count = await prisma.deadlineRule.count();
  const rule = await prisma.deadlineRule.create({
    data: { ...ruleData(parsed.data), sortOrder: count },
  });
  await logActivity({
    matterId: null,
    userId,
    type: "automation",
    title: `Created deadline rule: ${rule.title}`,
  });
  revalidatePath(SETTINGS_PATH);
  return { status: "ok" };
}

export async function updateDeadlineRule(
  ruleId: string,
  _prev: AutomationFormState,
  formData: FormData
): Promise<AutomationFormState> {
  const userId = await requirePermission("automations.deadline_rule.edit");
  const parsed = ruleSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { status: "error", errors: parsed.error.flatten().fieldErrors };
  const existing = await prisma.deadlineRule.findUnique({ where: { id: ruleId }, select: { id: true } });
  if (!existing) return fail("_form", "Rule not found");
  const bad = await checkAnchorRule(ruleId, parsed.data);
  if (bad) return bad;

  let rule;
  try {
    rule = await prisma.deadlineRule.update({
      where: { id: ruleId },
      data: ruleData(parsed.data),
    });
  } catch (err) {
    if (isRecordNotFound(err)) return fail("_form", "Rule not found");
    throw err;
  }
  await logActivity({
    matterId: null,
    userId,
    type: "automation",
    title: `Edited deadline rule: ${rule.title}`,
  });
  revalidatePath(SETTINGS_PATH);
  return { status: "ok" };
}

/** Archive / restore. Archived rules are skipped by every apply path. */
export async function setDeadlineRuleActive(
  ruleId: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("automations.deadline_rule.edit");
  let rule;
  try {
    rule = await prisma.deadlineRule.update({
      where: { id: ruleId },
      data: { isActive },
      select: { title: true },
    });
  } catch (err) {
    if (isRecordNotFound(err)) return { ok: false, error: "Rule not found." };
    throw err;
  }
  await logActivity({
    matterId: null,
    userId,
    type: "automation",
    title: `${isActive ? "Restored" : "Archived"} deadline rule: ${rule.title}`,
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function deleteDeadlineRule(
  ruleId: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("automations.deadline_rule.delete");
  const rule = await prisma.deadlineRule.findUnique({
    where: { id: ruleId },
    select: { title: true, dependents: { select: { title: true } } },
  });
  if (!rule) return { ok: false, error: "Rule not found." };
  if (rule.dependents.length > 0) {
    return {
      ok: false,
      error: `Other rules count from this one (${rule.dependents
        .map((d) => d.title)
        .join(", ")}). Change or delete those first, or archive this rule instead.`,
    };
  }
  // Generated deadlines keep their rows (FK SetNull); AutoApply rows
  // pointing at the rule cascade away with it.
  try {
    await prisma.deadlineRule.delete({ where: { id: ruleId } });
  } catch (err) {
    if (isRecordNotFound(err)) return { ok: false, error: "Rule not found." };
    if (isForeignKeyViolation(err)) {
      return {
        ok: false,
        error: "Another rule now counts from this one. Change or delete it first, or archive this rule instead.",
      };
    }
    throw err;
  }
  await logActivity({
    matterId: null,
    userId,
    type: "automation",
    title: `Deleted deadline rule: ${rule.title}`,
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

// ── Task lists ─────────────────────────────────────────────────────

const itemSchema = z.object({
  title: z.string().trim().min(1, "Every task needs a title").max(200),
  description: z.string().trim().max(4000).nullish(),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  assignTo: z.enum(["lead", "unassigned"]).default("unassigned"),
  dueOffsetDays: z.number().int().min(0).max(3650).nullish(),
});

const taskListSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  items: z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Couldn't read the task items" });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .array(itemSchema)
        .min(1, "Add at least one task")
        .max(100, "A list can hold up to 100 tasks")
    ),
});

function parseTaskList(formData: FormData) {
  return taskListSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    items: formData.get("items") ?? "[]",
  });
}

function itemRows(items: z.infer<typeof itemSchema>[]) {
  return items.map((it, i) => ({
    title: it.title,
    description: it.description || null,
    priority: it.priority,
    assignTo: it.assignTo,
    dueOffsetDays: it.dueOffsetDays ?? null,
    sortOrder: i,
  }));
}

export async function createTaskList(
  _prev: AutomationFormState,
  formData: FormData
): Promise<AutomationFormState> {
  const userId = await requirePermission("automations.task_list.create");
  const parsed = parseTaskList(formData);
  if (!parsed.success) return { status: "error", errors: parsed.error.flatten().fieldErrors };

  const count = await prisma.taskList.count();
  const list = await prisma.taskList.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      sortOrder: count,
      items: { create: itemRows(parsed.data.items) },
    },
  });
  await logActivity({
    matterId: null,
    userId,
    type: "automation",
    title: `Created task list: ${list.name}`,
    detail: `${parsed.data.items.length} task${parsed.data.items.length === 1 ? "" : "s"}`,
  });
  revalidatePath(SETTINGS_PATH);
  return { status: "ok" };
}

/** Replaces the list's items wholesale — the editor posts the full,
 *  ordered list. Tasks already created from it are untouched. */
export async function updateTaskList(
  taskListId: string,
  _prev: AutomationFormState,
  formData: FormData
): Promise<AutomationFormState> {
  const userId = await requirePermission("automations.task_list.edit");
  const parsed = parseTaskList(formData);
  if (!parsed.success) return { status: "error", errors: parsed.error.flatten().fieldErrors };
  const existing = await prisma.taskList.findUnique({ where: { id: taskListId }, select: { id: true } });
  if (!existing) return fail("_form", "Task list not found");

  try {
    await prisma.$transaction([
      prisma.taskListItem.deleteMany({ where: { taskListId } }),
      prisma.taskList.update({
        where: { id: taskListId },
        data: {
          name: parsed.data.name,
          description: parsed.data.description || null,
          items: { create: itemRows(parsed.data.items) },
        },
      }),
    ]);
  } catch (err) {
    // Deleted between the check and the write; the transaction rolled back.
    if (isRecordNotFound(err)) return fail("_form", "Task list not found");
    throw err;
  }
  await logActivity({
    matterId: null,
    userId,
    type: "automation",
    title: `Edited task list: ${parsed.data.name}`,
  });
  revalidatePath(SETTINGS_PATH);
  return { status: "ok" };
}

export async function setTaskListActive(
  taskListId: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("automations.task_list.edit");
  let list;
  try {
    list = await prisma.taskList.update({
      where: { id: taskListId },
      data: { isActive },
      select: { name: true },
    });
  } catch (err) {
    if (isRecordNotFound(err)) return { ok: false, error: "Task list not found." };
    throw err;
  }
  await logActivity({
    matterId: null,
    userId,
    type: "automation",
    title: `${isActive ? "Restored" : "Archived"} task list: ${list.name}`,
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function deleteTaskList(
  taskListId: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("automations.task_list.delete");
  const list = await prisma.taskList.findUnique({ where: { id: taskListId }, select: { name: true } });
  if (!list) return { ok: false, error: "Task list not found." };
  // Items + AutoApply rows cascade; created tasks keep their rows.
  try {
    await prisma.taskList.delete({ where: { id: taskListId } });
  } catch (err) {
    if (isRecordNotFound(err)) return { ok: false, error: "Task list not found." };
    throw err;
  }
  await logActivity({
    matterId: null,
    userId,
    type: "automation",
    title: `Deleted task list: ${list.name}`,
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

// ── Defaults (AutoApply) ───────────────────────────────────────────

const defaultSchema = z
  .object({
    trigger: z.enum(AUTO_APPLY_TRIGGERS).default("matter_created"),
    /** "" = every practice area. */
    practiceAreaId: z.string().trim().optional().or(z.literal("")),
    target: z
      .string()
      .regex(/^(rule|list):.+$/, "Pick a deadline rule or task list"),
  });

export async function addAutoApply(
  _prev: AutomationFormState,
  formData: FormData
): Promise<AutomationFormState> {
  const userId = await requirePermission("automations.defaults.create");
  const parsed = defaultSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { status: "error", errors: parsed.error.flatten().fieldErrors };
  const { trigger } = parsed.data;
  const practiceAreaId = parsed.data.practiceAreaId || null;
  const [kind, targetId] = [
    parsed.data.target.slice(0, 4),
    parsed.data.target.slice(5),
  ];

  let label: string;
  if (kind === "rule") {
    const rule = await prisma.deadlineRule.findUnique({ where: { id: targetId }, select: { title: true } });
    if (!rule) return fail("target", "That rule no longer exists");
    label = `deadline rule "${rule.title}"`;
  } else {
    const list = await prisma.taskList.findUnique({ where: { id: targetId }, select: { name: true } });
    if (!list) return fail("target", "That task list no longer exists");
    label = `task list "${list.name}"`;
  }
  let areaName = "all practice areas";
  if (practiceAreaId) {
    const area = await prisma.practiceArea.findUnique({ where: { id: practiceAreaId }, select: { name: true } });
    if (!area) return fail("practiceAreaId", "That practice area no longer exists");
    areaName = area.name;
  }

  const target =
    kind === "rule" ? { deadlineRuleId: targetId } : { taskListId: targetId };
  const dupe = await prisma.autoApply.findFirst({
    where: { trigger, practiceAreaId, ...target },
    select: { id: true },
  });
  if (dupe) return fail("target", "That's already a default for this practice area");

  try {
    await prisma.autoApply.create({ data: { trigger, practiceAreaId, ...target } });
  } catch (err) {
    // Target (or practice area) deleted after the existence checks above.
    if (isForeignKeyViolation(err)) {
      return fail("target", "That rule, task list or practice area no longer exists");
    }
    throw err;
  }
  await logActivity({
    matterId: null,
    userId,
    type: "automation",
    title: `New matters (${areaName}) will get ${label}`,
  });
  revalidatePath(SETTINGS_PATH);
  return { status: "ok" };
}

export async function removeAutoApply(
  autoApplyId: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("automations.defaults.delete");
  const row = await prisma.autoApply.findUnique({
    where: { id: autoApplyId },
    include: {
      practiceArea: { select: { name: true } },
      deadlineRule: { select: { title: true } },
      taskList: { select: { name: true } },
    },
  });
  if (!row) return { ok: false, error: "Default not found." };
  try {
    await prisma.autoApply.delete({ where: { id: autoApplyId } });
  } catch (err) {
    // Another admin (or a double click) removed it first.
    if (isRecordNotFound(err)) return { ok: false, error: "Default not found." };
    throw err;
  }
  const what = row.deadlineRule
    ? `deadline rule "${row.deadlineRule.title}"`
    : `task list "${row.taskList?.name}"`;
  await logActivity({
    matterId: null,
    userId,
    type: "automation",
    title: `New matters (${row.practiceArea?.name ?? "all practice areas"}) no longer get ${what}`,
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

// ── Manual apply on a matter ───────────────────────────────────────

function revalidateMatter(matterId: string, tab: "deadlines" | "tasks") {
  revalidatePath(`/matters/${matterId}/${tab}`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath("/"); // dashboard deadline/task cards
  if (tab === "deadlines") revalidatePath("/calendar");
}

/**
 * Apply one deadline rule to a matter. Round-trips with the dialog:
 * `duplicate` → resend with `force`; `needs_date` → resend with
 * `anchorDate` (YYYY-MM-DD).
 */
export async function applyDeadlineRuleToMatter(
  matterId: string,
  ruleId: string,
  opts: { anchorDate?: string; force?: boolean } = {}
): Promise<ApplyRuleResult> {
  const userId = await requirePermission("deadlines.create");
  await assertMatterAccess(matterId);
  if (opts.anchorDate && !isDayKey(opts.anchorDate)) {
    return { status: "error", error: "Enter a valid date." };
  }
  const [matter, rule, tz] = await Promise.all([
    prisma.matter.findUnique({ where: { id: matterId }, select: { id: true } }),
    prisma.deadlineRule.findFirst({ where: { id: ruleId, isActive: true }, select: { title: true, anchorLabel: true, anchor: true } }),
    getCurrentUserTimeZone(),
  ]);
  if (!matter) return { status: "error", error: "Matter not found." };
  if (!rule) return { status: "error", error: "That rule isn't available." };

  const res = await prisma.$transaction(async (tx) => {
    await lockMatterForApply(tx, matterId);
    return applyDeadlineRules(tx, {
      matterId,
      ruleIds: [ruleId],
      tz,
      anchorDates: opts.anchorDate ? { [ruleId]: opts.anchorDate } : undefined,
      onDuplicate: opts.force ? "create" : "report",
      onUnplanned: "report",
    });
  });
  if (res.duplicates.length > 0 && res.created.length === 0 && !opts.force) {
    return { status: "duplicate", title: rule.title };
  }
  if (res.unplanned.length > 0) {
    if (res.unplanned[0].code === "out_of_range") {
      // No date the user could type fixes this: the rule's offset is the problem.
      return {
        status: "error",
        error: `"${rule.title}" can't be applied: ${res.unplanned[0].reason}.`,
      };
    }
    return {
      status: "needs_date",
      title: rule.title,
      reason: res.unplanned[0].reason,
      label:
        rule.anchorLabel || (rule.anchor === "incident_date" ? "Incident date" : "Anchor date"),
    };
  }
  const created = res.created[0];
  if (!created) return { status: "error", error: "Nothing was applied." };

  await logActivity({
    matterId,
    userId,
    type: "deadline",
    title: `Applied deadline rule: ${created.title}`,
    detail: `Due ${created.dueKey}`,
  });
  revalidateMatter(matterId, "deadlines");
  return { status: "ok", title: created.title, dueKey: created.dueKey };
}

/** Apply one task list to a matter. `duplicate` → resend with force. */
export async function applyTaskListToMatter(
  matterId: string,
  taskListId: string,
  opts: { force?: boolean } = {}
): Promise<ApplyTaskListResult> {
  const userId = await requirePermission("tasks.create");
  await assertMatterAccess(matterId);
  const [matter, tz] = await Promise.all([
    prisma.matter.findUnique({ where: { id: matterId }, select: { id: true } }),
    getCurrentUserTimeZone(),
  ]);
  if (!matter) return { status: "error", error: "Matter not found." };

  const res = await prisma.$transaction(async (tx) => {
    await lockMatterForApply(tx, matterId);
    return applyTaskList(tx, {
      matterId,
      taskListId,
      tz,
      onDuplicate: opts.force ? "create" : "report",
    });
  });
  if (!res.listName) return { status: "error", error: "That task list isn't available." };
  if (res.createdTaskIds.length === 0 && res.duplicate) {
    return { status: "duplicate", name: res.listName };
  }
  await logActivity({
    matterId,
    userId,
    type: "task",
    title: `Applied task list: ${res.listName}`,
    detail: `${res.createdTaskIds.length} task${res.createdTaskIds.length === 1 ? "" : "s"} added`,
  });
  revalidateMatter(matterId, "tasks");
  return { status: "ok", name: res.listName, count: res.createdTaskIds.length };
}
