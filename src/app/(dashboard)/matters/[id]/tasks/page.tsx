/**
 * Matter Detail — Tasks tab
 *
 * Task checklist grouped by status (Open / In progress / In review /
 * Done) — rendered by TaskListByStatus, shared with the intake Tasks
 * tab. Write controls follow the viewer's permissions.
 */

import { CheckSquare } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { TaskComposer } from "@/components/matters/captures/task-composer";
import { ApplyTaskListDialog } from "@/components/automations/apply-task-list-dialog";
import { TaskListByStatus, type TaskRowPerms } from "@/components/tasks/task-list-by-status";
import { listTaskLists } from "@/lib/queries/automations";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getCaptureAccess } from "@/lib/capture-access";
import { getMatterTasks } from "@/lib/queries/matter-detail";
import { listAssigneeOptions } from "@/lib/queries/team";
import { getCurrentUserId, requireUser } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";

export default async function MatterTasksPage({ params }: PageProps<"/matters/[id]">) {
  await requireUser();
  const { id } = await params;
  await assertMatterAccess(id);
  // Assignees feed the composer + edit-dialog pickers; the current
  // user id is the composer's default selection (self-assign).
  // The task-list library does not depend on the matter or the
  // permission result, so it runs in the same batch; it is discarded
  // below for viewers who couldn't apply a list.
  const [
    tasks,
    versions,
    assignees,
    currentUserId,
    allTaskLists,
    tz,
    canCreate,
    canEdit,
    canDelete,
    canLogTime,
    canAddNote,
    canConvert,
    captureAccess,
  ] = await Promise.all([
    getMatterTasks(id),
    // Row versions for the edit dialog's stale-form guard.
    prisma.task.findMany({
      where: { matterId: id },
      select: { id: true, updatedAt: true },
    }),
    listAssigneeOptions(),
    getCurrentUserId(),
    listTaskLists({ activeOnly: true }),
    getCurrentUserTimeZone(),
    currentUserHasPermission("tasks.create"),
    currentUserHasPermission("tasks.edit"),
    currentUserHasPermission("tasks.delete"),
    currentUserHasPermission("time_entries.create"),
    currentUserHasPermission("notes.create"),
    currentUserHasPermission("deadlines.create"),
    getCaptureAccess(),
  ]);
  const taskLists = canCreate ? allTaskLists : [];
  const updatedAtById = new Map(versions.map((v) => [v.id, v.updatedAt.toISOString()]));
  const perms: TaskRowPerms = {
    canEdit,
    canDelete,
    canLogTime,
    canAddNote,
    canConvert,
  };

  return (
    <div className="p-5 flex flex-col gap-5">
      {taskLists.length > 0 && (
        <div className="flex justify-end -mb-2">
          <ApplyTaskListDialog
            matterId={id}
            lists={taskLists.map((l) => ({
              id: l.id,
              name: l.name,
              itemTitles: l.items.map((i) => i.title),
            }))}
          />
        </div>
      )}
      {canCreate && (
        <TaskComposer
          scope={{ kind: "matter", matterId: id }}
          assignees={assignees}
          currentUserId={currentUserId}
          siblingKinds={captureAccess.kinds}
          canPin={captureAccess.canPin}
        />
      )}

      {tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks yet"
          description={canCreate ? "Add the first one above." : undefined}
          className="py-6"
        />
      ) : null}

      <TaskListByStatus
        tasks={tasks}
        matterId={id}
        assignees={assignees}
        tz={tz}
        updatedAtById={updatedAtById}
        perms={perms}
      />
    </div>
  );
}
