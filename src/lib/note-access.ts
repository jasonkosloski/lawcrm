/**
 * Resolve the viewer's Notes-surface access (server-only).
 *
 * One cached permission lookup per request, mapped to the plain
 * booleans `NoteAccess` carries to client components. Pages that
 * render note controls call this and pass the result down.
 */

import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserPermissions } from "@/lib/permission-check";
import type { NoteAccess } from "@/lib/note-constants";

export async function getNoteAccess(): Promise<NoteAccess> {
  const [userId, { isAdmin, granted }] = await Promise.all([
    getCurrentUserId(),
    getCurrentUserPermissions(),
  ]);
  const has = (key: string): boolean => isAdmin || granted.has(key);
  return {
    userId,
    canCreateNote: has("notes.create"),
    canPin: has("notes.pin"),
    canDeleteAnyNote: has("notes.delete_any"),
    canCreateTask: has("tasks.create"),
    canDeleteTask: has("tasks.delete"),
    canCreateDeadline: has("deadlines.create"),
    canDeleteDeadline: has("deadlines.delete"),
    canCreateTime: has("time_entries.create"),
    canDeleteAnyTime: has("time_entries.delete_any"),
    canCreateEvent: has("events.create"),
  };
}
