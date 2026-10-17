/**
 * Which sibling capture kinds the CURRENT viewer may add.
 *
 * The primary composers (task / event / deadline / time) let a user
 * queue sibling records; the server action demands each sibling
 * kind's own create key before writing anything (ADR-013/025) and
 * answers a miss with a redirect to `/` — which throws away whatever
 * the user typed. Pages resolve this once on the server and pass the
 * result to the composer so the buttons for kinds the viewer can't
 * use are never offered.
 *
 * Server-side (reads the viewer's grants); the pure filter is split
 * out for tests.
 */

import {
  CAPTURE_CREATE_PERMISSION,
  NOTE_PIN_PERMISSION,
} from "@/lib/capture-permissions";
import { getCurrentUserPermissions } from "@/lib/permission-check";
import type { CaptureKind } from "@/lib/note-constants";

export type CaptureAccess = {
  /** Sibling kinds the viewer holds the create key for. */
  kinds: CaptureKind[];
  /** Whether a sibling note may be pinned (`notes.pin`). */
  canPin: boolean;
};

/** Pure: resolve access from a viewer's grants. Admins hold everything. */
export function resolveCaptureAccess(
  isAdmin: boolean,
  granted: ReadonlySet<string>
): CaptureAccess {
  const has = (key: string) => isAdmin || granted.has(key);
  const kinds = (Object.keys(CAPTURE_CREATE_PERMISSION) as CaptureKind[]).filter(
    (kind) => has(CAPTURE_CREATE_PERMISSION[kind])
  );
  return { kinds, canPin: has(NOTE_PIN_PERMISSION) };
}

export async function getCaptureAccess(): Promise<CaptureAccess> {
  const { isAdmin, granted } = await getCurrentUserPermissions();
  return resolveCaptureAccess(isAdmin, granted);
}
