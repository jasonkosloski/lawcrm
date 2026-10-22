/**
 * Permission keys for capture-created records.
 *
 * Every record kind a capture can create (task / event / deadline /
 * time entry / sibling note) must clear the SAME create gate as that
 * kind's standalone create action, no matter which surface carried
 * it (primary composers in captures.ts, createNote, the bulk-attach
 * action). Otherwise a role granted only one create key could mint
 * the other kinds through a sibling — e.g. billable time without
 * `time_entries.create` (ADR-013). Pinning a sibling note
 * additionally needs `notes.pin` (pinning is a firm-wide signal).
 *
 * Pure (no server-only imports) so it is unit-testable; callers feed
 * the result to `requirePermissions` from `@/lib/permission-check`.
 */

import type { ValidCapture } from "@/lib/capture-schemas";

type CaptureKind = ValidCapture["kind"];

export const CAPTURE_CREATE_PERMISSION: Record<CaptureKind, string> = {
  task: "tasks.create",
  event: "events.create",
  deadline: "deadlines.create",
  time: "time_entries.create",
  note_sibling: "notes.create",
};

export const NOTE_PIN_PERMISSION = "notes.pin";

/** The distinct permission keys needed to create `captures`, computed
 *  before any write. `ignoreKinds` drops kinds a surface never
 *  creates (the bulk-attach action ignores `note_sibling`).
 *  `pinRequested` adds `notes.pin` for a pinned primary note. */
export function requiredCapturePermissions(
  captures: readonly ValidCapture[],
  opts: { ignoreKinds?: readonly CaptureKind[]; pinRequested?: boolean } = {},
): string[] {
  const keys = new Set<string>();
  for (const cap of captures) {
    if (opts.ignoreKinds?.includes(cap.kind)) continue;
    keys.add(CAPTURE_CREATE_PERMISSION[cap.kind]);
    if (cap.kind === "note_sibling" && cap.isPinned) {
      keys.add(NOTE_PIN_PERMISSION);
    }
  }
  if (opts.pinRequested) keys.add(NOTE_PIN_PERMISSION);
  return [...keys];
}
