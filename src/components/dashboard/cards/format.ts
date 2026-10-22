/** `value` as a whole percent of `goal`: 0 when goal <= 0, capped at 100. */
export function percentOf(value: number, goal: number): number {
  if (!(goal > 0) || !(value > 0)) return 0;
  return Math.min(100, Math.round((value / goal) * 100));
}
