/**
 * Lead Detail — Tasks tab
 *
 * The lead-scoped mirror of the matter Tasks tab: intake to-dos
 * (call back, request records, send engagement letter) on the lead
 * via `Task.leadId` before a matter exists. Same composer and
 * status-grouped list (TaskListByStatus), same tasks.* permissions.
 * Matter-only features are left out — no sibling captures, task-list
 * templates, log time, add note or convert to deadline — since those
 * need a matter.
 *
 * On conversion every task re-homes onto the new matter
 * (convertLeadToMatter) and this tab points there instead.
 */

import Link from "next/link";
import { Briefcase, CheckSquare } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { TaskComposer } from "@/components/matters/captures/task-composer";
import { TaskListByStatus, type TaskRowPerms } from "@/components/tasks/task-list-by-status";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getLeadTasks } from "@/lib/queries/matter-detail";
import { listAssigneeOptions } from "@/lib/queries/team";
import { getCurrentUserId, requireUser } from "@/lib/current-user";
import { assertLeadAccess } from "@/lib/lead-access";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { prisma } from "@/lib/prisma";

export default async function LeadTasksPage({ params }: PageProps<"/intake/[id]/tasks">) {
  await requireUser();
  const { id } = await params;
  await assertLeadAccess(id);
  const [lead, tasks, versions, assignees, currentUserId, tz, canCreate, canEdit, canDelete] =
    await Promise.all([
      // Stage decides whether the composer renders: a converted lead's
      // tasks already moved to the matter (createLeadTask refuses it).
      prisma.lead.findUnique({
        where: { id },
        select: { stage: true, convertedMatterId: true },
      }),
      getLeadTasks(id),
      // Row versions for the edit dialog's stale-form guard.
      prisma.task.findMany({
        where: { leadId: id },
        select: { id: true, updatedAt: true },
      }),
      listAssigneeOptions(),
      getCurrentUserId(),
      getCurrentUserTimeZone(),
      currentUserHasPermission("tasks.create"),
      currentUserHasPermission("tasks.edit"),
      currentUserHasPermission("tasks.delete"),
    ]);
  // The layout notFound()s missing leads; render nothing if the row
  // vanished between the layout's fetch and ours.
  if (!lead) return null;

  const isConverted = lead.stage === "converted";
  const updatedAtById = new Map(versions.map((v) => [v.id, v.updatedAt.toISOString()]));
  // Log time / add note / convert to deadline all need a matter (their
  // actions refuse a task without one), so they're never offered here.
  const perms: TaskRowPerms = {
    canEdit,
    canDelete,
    canLogTime: false,
    canAddNote: false,
    canConvert: false,
  };

  return (
    <div className="p-5 flex flex-col gap-5">
      {isConverted ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper-2 px-3 py-2.5">
          <p className="text-xs text-ink-3">
            This lead converted — its intake tasks were carried forward to the matter. Add new tasks
            there.
          </p>
          {lead.convertedMatterId && (
            <Link
              href={`/matters/${lead.convertedMatterId}/tasks`}
              className="inline-flex items-center gap-1.5 shrink-0 text-xs font-medium text-brand-700 hover:underline"
            >
              <Briefcase size={13} />
              Open matter tasks
            </Link>
          )}
        </div>
      ) : (
        canCreate && (
          <TaskComposer
            scope={{ kind: "lead", leadId: id }}
            assignees={assignees}
            currentUserId={currentUserId}
            siblingKinds={[]}
          />
        )
      )}

      {tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No intake tasks yet"
          description={canCreate && !isConverted ? "Add the first one above." : undefined}
          className="py-6"
        />
      ) : null}

      <TaskListByStatus
        tasks={tasks}
        matterId={null}
        assignees={assignees}
        tz={tz}
        updatedAtById={updatedAtById}
        perms={perms}
      />
    </div>
  );
}
