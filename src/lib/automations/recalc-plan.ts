/**
 * Dependent-deadline recalculation — pure planning (ADR-040).
 *
 * When a date that rule-generated deadlines count from changes — a
 * deadline's due date, or the matter's incident date — this works out
 * which deadlines would move, from what to what. Nothing is written
 * here; callers show the plan for explicit confirmation and then apply
 * only the deadlines the user ticked (`selected`).
 *
 * Rules:
 *   - Chains are followed: trial → pretrial order → motions.
 *   - The anchor for a rule's dependents is that rule's NEWEST deadline
 *     on the matter — the same deadline `applyDeadlineRules` counts
 *     from when the dependent is first applied.
 *   - Only open deadlines move. A completed / waived one stays put, and
 *     so does everything counting from it (its date didn't change).
 *   - A deadline whose date was set by hand (`manual`) is still listed,
 *     flagged, so the UI can default it to unticked.
 *   - When `selected` is given, an unselected deadline neither moves
 *     nor propagates: what counts from it keeps its date too.
 *   - Offsets use `applyOffsetToKey` — identical math to applying the
 *     rule fresh, so a recalculated date equals a newly applied one.
 */

import { applyOffsetToKey, isDayKey } from "./deadline-plan";

export type RecalcDeadline = {
  id: string;
  title: string;
  /** open | overdue | completed | waived — only open/overdue move. */
  status: string;
  dueKey: string;
  ruleId: string | null;
  /** For picking each rule's newest deadline (the anchor). */
  createdAtMs: number;
  /** `Deadline.dueDateSetManually`. */
  manual: boolean;
};

export type RecalcRule = {
  id: string;
  title: string;
  anchor: string;
  anchorRuleId: string | null;
  offsetDays: number;
  offsetUnit: string;
};

export type RecalcTrigger =
  | { kind: "deadline"; deadlineId: string; newDueKey: string }
  | { kind: "incident"; newIncidentKey: string };

export type RecalcChange = {
  deadlineId: string;
  title: string;
  ruleTitle: string;
  fromKey: string;
  toKey: string;
  /** Date was set by hand — the UI defaults it to unticked. */
  manual: boolean;
  /** The deadline this one counts from; null = the trigger itself
   *  (the edited deadline, or the incident date). Lets the UI disable
   *  a row whose anchor is unticked. */
  anchorDeadlineId: string | null;
  /** What it counts from, in words ("Trial", "Incident date"). */
  anchorText: string;
};

const MOVABLE = new Set(["open", "overdue"]);

export function planRecalc(
  deadlines: readonly RecalcDeadline[],
  rules: readonly RecalcRule[],
  trigger: RecalcTrigger,
  opts: { selected?: ReadonlySet<string> } = {}
): RecalcChange[] {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const byRule = new Map<string, RecalcDeadline[]>();
  for (const d of deadlines) {
    if (!d.ruleId) continue;
    const list = byRule.get(d.ruleId) ?? [];
    list.push(d);
    byRule.set(d.ruleId, list);
  }
  const newestOf = (ruleId: string): RecalcDeadline | undefined =>
    (byRule.get(ruleId) ?? []).reduce<RecalcDeadline | undefined>(
      (best, d) => (!best || d.createdAtMs > best.createdAtMs ? d : best),
      undefined
    );

  const changes: RecalcChange[] = [];
  // ruleId → its anchor deadline's NEW key, for rules whose anchor moved.
  type Moved = { ruleId: string; newKey: string; anchorDeadlineId: string | null; anchorText: string };
  const queue: Moved[] = [];
  const visited = new Set<string>();

  // Move every open deadline of `rule` given its anchor's new key;
  // enqueue the rule when its anchor deadline (newest) actually moved.
  const moveRule = (rule: RecalcRule, anchorKey: string, anchorDeadlineId: string | null, anchorText: string) => {
    if (visited.has(rule.id)) return; // defensive: loops are refused on save
    visited.add(rule.id);
    const toKey = applyOffsetToKey(anchorKey, rule.offsetDays, rule.offsetUnit);
    if (!isDayKey(toKey)) return;
    const newest = newestOf(rule.id);
    for (const d of byRule.get(rule.id) ?? []) {
      if (!MOVABLE.has(d.status) || d.dueKey === toKey) continue;
      if (opts.selected && !opts.selected.has(d.id)) continue;
      changes.push({
        deadlineId: d.id,
        title: d.title,
        ruleTitle: rule.title,
        fromKey: d.dueKey,
        toKey,
        manual: d.manual,
        anchorDeadlineId,
        anchorText,
      });
    }
    // Propagate only through the anchor deadline, and only if it moves.
    const anchorMoves =
      newest &&
      MOVABLE.has(newest.status) &&
      newest.dueKey !== toKey &&
      (!opts.selected || opts.selected.has(newest.id));
    if (anchorMoves) {
      queue.push({ ruleId: rule.id, newKey: toKey, anchorDeadlineId: newest.id, anchorText: newest.title });
    }
  };

  if (trigger.kind === "deadline") {
    const edited = deadlines.find((d) => d.id === trigger.deadlineId);
    // Only a rule's newest deadline is an anchor for its dependents.
    if (edited?.ruleId && newestOf(edited.ruleId)?.id === edited.id) {
      visited.add(edited.ruleId);
      queue.push({
        ruleId: edited.ruleId,
        newKey: trigger.newDueKey,
        anchorDeadlineId: null,
        anchorText: edited.title,
      });
    }
  } else {
    for (const rule of rules) {
      if (rule.anchor === "incident_date") {
        moveRule(rule, trigger.newIncidentKey, null, "Incident date");
      }
    }
  }

  while (queue.length > 0) {
    const moved = queue.shift()!;
    for (const rule of rules) {
      if (rule.anchor === "rule" && rule.anchorRuleId === moved.ruleId && ruleById.has(rule.id)) {
        moveRule(rule, moved.newKey, moved.anchorDeadlineId, moved.anchorText);
      }
    }
  }
  return changes;
}
