/**
 * Read-side permission flags for the communication readers' action
 * affordances (Save as note / Create task / Create deadline / Log time
 * / File to matter).
 *
 * Each of those actions gates itself with `requirePermission`, which
 * REDIRECTS to the dashboard on denial - so a user who lacks the key
 * and fills in a dialog loses their input and gets bounced with no
 * explanation. The readers (async server components) resolve these
 * flags once per render, in parallel (the resolver behind
 * `currentUserHasPermission` is cached per request), and hide the
 * buttons the viewer can't use.
 */

import { currentUserHasPermission } from "@/lib/permission-check";

export type CommActionPermissions = {
  /** `tasks.create` */
  canCreateTask: boolean;
  /** `deadlines.create` */
  canCreateDeadline: boolean;
  /** `notes.create` */
  canCreateNote: boolean;
  /** `time_entries.create` */
  canLogTime: boolean;
  /** `communication.file_email` */
  canFileEmail: boolean;
};

export async function getCommActionPermissions(): Promise<CommActionPermissions> {
  const [canCreateTask, canCreateDeadline, canCreateNote, canLogTime, canFileEmail] =
    await Promise.all([
      currentUserHasPermission("tasks.create"),
      currentUserHasPermission("deadlines.create"),
      currentUserHasPermission("notes.create"),
      currentUserHasPermission("time_entries.create"),
      currentUserHasPermission("communication.file_email"),
    ]);
  return {
    canCreateTask,
    canCreateDeadline,
    canCreateNote,
    canLogTime,
    canFileEmail,
  };
}
