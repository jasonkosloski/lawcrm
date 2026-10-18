/**
 * Matter Detail — Deadlines tab reader.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { sanitizeUserHtml } from "@/lib/sanitize-html";
import {
  resolveTz,
  daysUntilDueDate,
  EVENT_REF_SELECT,
  scrubEventRef,
} from "./shared";
import {
  EntitySource,
  AttachedNotePreview,
  resolveEntitySource,
} from "./tasks";

// ── Deadlines ────────────────────────────────────────────────────────────

export type DeadlineRow = {
  id: string;
  title: string;
  dueDate: Date;
  daysUntil: number;
  isOverdue: boolean;
  kind: string;
  /** Legal source of the deadline (statute / scheduling order / rule).
   *  Distinct from `spawnedFrom` (which captures *which surface* the
   *  user used to create the deadline — note / email / messenger). */
  sourceType: string | null;
  sourceRef: string | null;
  description: string | null;
  status: string;
  ownerName: string | null;
  ownerInitials: string | null;
  spawnedFrom: EntitySource | null;
  attachedNotes: AttachedNotePreview[];
};

/** Options shared by the deadline / task list queries. */
export type MatterListOptions = {
  /** Viewer's IANA zone for the "days until" math. Resolved from the
   *  session when omitted. */
  tz?: string;
  /** Only rows still needing action (deadlines: open; tasks: open +
   *  in_progress). The Overview preview uses this with `limit`. */
  openOnly?: boolean;
  /** Cap on rows returned (applied after the open-only filter). */
  limit?: number;
};

export async function getMatterDeadlines(
  matterId: string,
  options: MatterListOptions = {}
): Promise<DeadlineRow[]> {
  const [viewerId, tz] = await Promise.all([
    getCurrentUserId(),
    resolveTz(options.tz),
  ]);
  const rows = await prisma.deadline.findMany({
    where: { matterId, ...(options.openOnly ? { status: "open" } : {}) },
    take: options.limit,
    include: {
      owner: { select: { name: true, initials: true } },
      parentNote: { select: { id: true, content: true } },
      emailThread: { select: { id: true, subject: true } },
      messengerItem: {
        select: {
          id: true,
          kind: true,
          thread: {
            select: {
              id: true,
              contactPhone: true,
              contact: { select: { name: true } },
            },
          },
        },
      },
      parentEvent: { select: EVENT_REF_SELECT },
      parentTask: { select: { id: true, title: true } },
      notes: {
        select: {
          id: true,
          content: true,
          type: true,
          createdAt: true,
          author: { select: { name: true, initials: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    // Status is NOT a DB sort key: alphabetically "completed" < "open",
    // which would bury live deadlines under history. Order by date here
    // and float the open ones in JS below.
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
  const shaped = rows.map((d) => {
    // dueDate is date-only: compare calendar days in the viewer's zone,
    // not instants (a deadline due today is "0d", never "0d late").
    const daysUntil = daysUntilDueDate(d.dueDate, tz);
    return {
      id: d.id,
      title: d.title,
      dueDate: d.dueDate,
      daysUntil,
      isOverdue: d.status === "open" && daysUntil < 0,
      kind: d.kind,
      sourceType: d.sourceType,
      sourceRef: d.sourceRef,
      description: d.description,
      status: d.status,
      ownerName: d.owner?.name ?? null,
      ownerInitials: d.owner?.initials ?? null,
      spawnedFrom: resolveEntitySource({
        note: d.parentNote,
        email: d.emailThread,
        messenger: d.messengerItem,
        event: scrubEventRef(d.parentEvent, viewerId),
        task: d.parentTask,
      }),
      attachedNotes: d.notes.map((n) => ({
        id: n.id,
        content: sanitizeUserHtml(n.content),
        type: n.type,
        authorName: n.author.name,
        authorInitials: n.author.initials,
        createdAt: n.createdAt,
      })),
    };
  });
  // Open deadlines first, then completed / waived history, each by due
  // date (the page header's promise). Array#sort is stable, so the
  // due-date order from the query survives within each group.
  return shaped.sort(
    (a, b) => Number(a.status !== "open") - Number(b.status !== "open")
  );
}
