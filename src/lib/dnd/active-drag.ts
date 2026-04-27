/**
 * Active-drag registry — module-global access to the currently-
 * dragged payload.
 *
 * The native DnD API hides the dropped JSON body until the actual
 * `drop` event for security reasons. That makes preview-during-
 * drag (a ghost outline, a where-it-will-land line, a snap-target
 * highlight) impossible from `dragover` alone.
 *
 * The workaround the rest of the world uses: on `dragstart`, the
 * source stashes its payload in a global, and `dragover` handlers
 * read it back. The browser only allows one drag at a time, so
 * "global" really means "the one drag in flight" — no concurrency
 * concerns. We clear on `dragend` (which fires on the source
 * regardless of whether the drop succeeded, was cancelled, or
 * landed outside any drop target).
 *
 * This complements `payload.ts` (the dataTransfer-based encoding
 * used at drop time, which is authoritative). Use the registry
 * for preview / hover state; use `readPayload` for the actual
 * commit.
 */

let active: { kind: string; data: unknown } | null = null;

export function setActiveDrag(kind: string, data: unknown): void {
  active = { kind, data };
}

export function clearActiveDrag(): void {
  active = null;
}

/** Returns the active drag's data when its kind matches the
 *  expected kind, or null otherwise. The kind check matches the
 *  drop-time `readPayload` semantics — kanban targets ignore
 *  calendar events and vice versa. */
export function peekActiveDrag<D>(expectedKind: string): D | null {
  if (!active || active.kind !== expectedKind) return null;
  return active.data as D;
}
