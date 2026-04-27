/**
 * Generic drag-and-drop payload helpers.
 *
 * Native HTML5 drag-and-drop ships in every browser, doesn't add a
 * dependency, and works fine for the modest interactions we need
 * (calendar event reschedule, kanban column moves, future
 * workflows). The friction with the raw API is just bookkeeping —
 * who's writing what to `dataTransfer`, who's reading it, and how
 * a drop target knows the payload it's looking at is the kind it
 * cares about.
 *
 * These helpers standardize that:
 *
 *   - Each "drag space" defines a unique `kind` string. The
 *     calendar uses `"calendar-event"`; future kanban will use
 *     `"matter-stage-card"` etc. A drop target ignores any
 *     payload whose kind doesn't match — defense against picking
 *     up an unrelated drag (e.g. a browser tab dragged from
 *     another window).
 *
 *   - Payloads are JSON-encoded and round-tripped through
 *     `dataTransfer`. The kind goes on a separate MIME type so
 *     drop targets can interrogate the payload kind during
 *     `dragover` (when most browsers DON'T expose the JSON body
 *     for security reasons).
 *
 * Usage shape:
 *
 *   // On the source:
 *   <div onDragStart={(e) => setDragPayload(e, { kind: "x", data })} />
 *
 *   // On the target:
 *   onDragOver: (e) => { if (hasKind(e, "x")) e.preventDefault(); }
 *   onDrop:     (e) => { const p = readPayload(e, "x"); if (p) dispatch(p); }
 */

export type DragPayload<K extends string, D> = {
  kind: K;
  data: D;
};

const PAYLOAD_MIME = "application/json";
/** Custom MIME for the kind sentinel. Lowercase only — Safari + iOS
 *  silently lowercase the type name during the dragover phase. */
const KIND_MIME = "application/x-lawcrm-dnd-kind";

/**
 * Write a typed payload to the drag event. Call from `onDragStart`.
 */
export function setDragPayload<K extends string, D>(
  e: React.DragEvent,
  payload: DragPayload<K, D>
): void {
  e.dataTransfer.setData(PAYLOAD_MIME, JSON.stringify(payload.data));
  e.dataTransfer.setData(KIND_MIME, payload.kind);
  e.dataTransfer.effectAllowed = "move";
}

/**
 * Cheap "is this drag of the kind I care about?" check usable
 * during `dragover`. The browser only exposes `types` (not the
 * data itself) until drop, so we sniff by MIME presence + a
 * second mime-derived check. Returns true when the dragged
 * payload's kind matches; false otherwise.
 *
 * Note: some browsers append types in lowercase — the constants
 * above are lowercase so the comparison is exact regardless.
 */
export function hasKind(e: React.DragEvent, kind: string): boolean {
  const types = Array.from(e.dataTransfer.types);
  // `getData` for non-text MIMEs is restricted during dragover in
  // Safari — fall back to a presence check + `kind` MIME being
  // present at all. We can't read the kind value here on Safari,
  // so the safest thing is "if our custom MIME is present, treat
  // it as ours and let onDrop confirm." The kind argument is
  // therefore advisory at this stage; readPayload below is the
  // authoritative check.
  if (types.includes(KIND_MIME)) {
    // Best-effort exact-kind read (works in Chromium / Firefox).
    const k = e.dataTransfer.getData(KIND_MIME);
    return k === "" || k === kind;
  }
  return false;
}

/**
 * Pull the typed payload out of a drop event. Returns null when
 * the drop isn't of the expected kind (e.g., a stray text drag,
 * or a payload from a different draggable space).
 *
 * Generic over the shape of the data so callers can narrow the
 * return without `as`.
 */
export function readPayload<D>(
  e: React.DragEvent,
  expectedKind: string
): D | null {
  const kind = e.dataTransfer.getData(KIND_MIME);
  if (kind !== expectedKind) return null;
  const json = e.dataTransfer.getData(PAYLOAD_MIME);
  if (!json) return null;
  try {
    return JSON.parse(json) as D;
  } catch {
    return null;
  }
}
