/**
 * Dependent-deadline recalculation — DB layer (ADR-040). Planning is
 * pure in `recalc-plan.ts`.
 *
 * Two calls, always in this order, never one without the other:
 *   1. `previewRecalc` — what WOULD move. The caller returns it to the
 *      UI for explicit confirmation; nothing is written.
 *   2. `applyRecalc` — re-plans from the current rows (inside the
 *      caller's transaction) and moves only the deadlines the user
 *      ticked. A deadline that wasn't in the confirmed selection is
 *      never changed, even if the plan grew in between.
 */

import type { Tx } from "@/lib/prisma";
import { dateOnlyKey } from "@/lib/format-date";
import { deadlineDateFromKey } from "./deadline-plan";
import {
  planRecalc,
  type RecalcChange,
  type RecalcDeadline,
  type RecalcRule,
  type RecalcTrigger,
} from "./recalc-plan";

export type { RecalcChange, RecalcTrigger } from "./recalc-plan";

async function loadInputs(
  tx: Tx,
  matterId: string,
): Promise<{ deadlines: RecalcDeadline[]; rules: RecalcRule[] }> {
  const [rows, rules] = await Promise.all([
    tx.deadline.findMany({
      where: { matterId, deadlineRuleId: { not: null } },
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        deadlineRuleId: true,
        createdAt: true,
        dueDateSetManually: true,
      },
    }),
    // The firm library is small; chains can pass through any rule.
    tx.deadlineRule.findMany({
      select: {
        id: true,
        title: true,
        anchor: true,
        anchorRuleId: true,
        offsetDays: true,
        offsetUnit: true,
      },
    }),
  ]);
  return {
    deadlines: rows.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      dueKey: dateOnlyKey(d.dueDate),
      ruleId: d.deadlineRuleId,
      createdAtMs: d.createdAt.getTime(),
      manual: d.dueDateSetManually,
    })),
    rules,
  };
}

export async function previewRecalc(
  tx: Tx,
  matterId: string,
  trigger: RecalcTrigger,
): Promise<RecalcChange[]> {
  const { deadlines, rules } = await loadInputs(tx, matterId);
  return planRecalc(deadlines, rules, trigger);
}

/** Move the confirmed deadlines. Returns what actually moved (for the
 *  activity log). Each moved deadline is back on its rule, so its
 *  hand-set marker is cleared. */
export async function applyRecalc(
  tx: Tx,
  matterId: string,
  trigger: RecalcTrigger,
  selectedIds: readonly string[],
): Promise<RecalcChange[]> {
  if (selectedIds.length === 0) return [];
  const { deadlines, rules } = await loadInputs(tx, matterId);
  // The trigger's own deadline was just written by the caller; plan
  // from the trigger's key, not the (possibly stale) row date.
  const changes = planRecalc(deadlines, rules, trigger, {
    selected: new Set(selectedIds),
  });
  for (const c of changes) {
    await tx.deadline.update({
      where: { id: c.deadlineId },
      data: { dueDate: deadlineDateFromKey(c.toKey), dueDateSetManually: false },
    });
  }
  return changes;
}

/** One activity-log detail line for a moved deadline. */
export function describeRecalc(c: RecalcChange): string {
  return `${c.title}: due ${c.fromKey} → ${c.toKey} (counts from ${c.anchorText})`;
}

/** Read the user's decision off a resubmitted form. */
export function readCascadeDecision(formData: FormData): {
  decision: "apply" | "skip" | null;
  selectedIds: string[];
} {
  const raw = formData.get("cascadeDecision");
  const decision = raw === "apply" || raw === "skip" ? raw : null;
  const selectedIds = formData
    .getAll("cascadeId")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  return { decision, selectedIds };
}
