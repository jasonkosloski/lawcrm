/**
 * Shared constants + types for practice area + stage forms.
 *
 * Lives outside the `src/app/actions/practice-areas.ts` server-action
 * file because Next.js "use server" modules can only export async
 * functions — non-async exports break the build.
 */

export type PracticeAreaFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export const practiceAreaInitialState: PracticeAreaFormState = {
  status: "idle",
};

export type StageFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export const stageInitialState: StageFormState = { status: "idle" };

/** Message shown when an area still has matters attached. Shared by the
 *  server action and the row-actions component so the two copies cannot
 *  drift. The count includes settled/closed matters, and the app has no
 *  matter-archive control, so the only way forward is moving them. */
export function areaArchiveBlockedMessage(matterCount: number): string {
  return `Cannot archive — ${matterCount} matter${matterCount === 1 ? "" : "s"} (including settled or closed ones) still use this area. Move them to another practice area first.`;
}

/** One planned `order` write for a reorder. */
export type OrderUpdate = { id: string; order: number };

/** Plan the writes for swapping `items[idx]` with `items[targetIdx]`.
 *  `items` must be the VISIBLE (active) siblings sorted by (order, id).
 *  Normally the two rows trade `order` values. When ANY rows share an
 *  `order` value (duplicates left by older data), trading can be a silent
 *  no-op or leave a tie, so every item is renumbered densely in its new
 *  position. */
export function planReorder(
  items: ReadonlyArray<{ id: string; order: number }>,
  idx: number,
  targetIdx: number
): OrderUpdate[] {
  const a = items[idx];
  const b = items[targetIdx];
  // Any duplicate `order` in the list (not just between the swapped pair)
  // can make a plain value-trade leave the visible order wrong once the
  // (order, id) tiebreak is applied, so renumber densely in that case.
  const hasDuplicates =
    new Set(items.map((i) => i.order)).size !== items.length;
  if (!hasDuplicates) {
    return [
      { id: a.id, order: b.order },
      { id: b.id, order: a.order },
    ];
  }
  const next = items.map((i) => i.id);
  next[idx] = b.id;
  next[targetIdx] = a.id;
  return next.map((id, i) => ({ id, order: i }));
}
