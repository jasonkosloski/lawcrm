/**
 * "Needs me now" triage data for the dashboard.
 *
 * Five groups of things that want the viewer's attention today. Every
 * group is scoped to what the viewer could already see elsewhere, and a
 * group the viewer lacks the permission for is omitted entirely (never
 * returned empty), as is any group with nothing in it:
 *
 *  1. deadlines   open deadlines on accessible, non-archived matters
 *                 due today or earlier (viewer's calendar day).
 *  2. tasks       open tasks owned by the viewer due today or earlier.
 *  3. email       unread, unarchived threads in the viewer's OWN
 *                 mailbox that are filed to an accessible matter.
 *  4. uploads     portal document requests a client has submitted
 *                 (status `submitted`), on accessible matters; needs
 *                 `portal.view`.
 *  5. agreements  open matters with no signed agreement on file; the
 *                 same admin-only gate and predicate as the firm
 *                 settings warning, and only while the firm's "require
 *                 an originating document" switch is on.
 *
 * Each group is capped at `TRIAGE_GROUP_LIMIT` rows; `hidden` carries
 * the exact remainder for a "+N more" line. Dates follow ADR-012: due
 * dates are date-only values matched against the viewer's day key.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { isCurrentUserAdmin } from "@/lib/firm";
import { currentUserHasPermission } from "@/lib/permission-check";
import { visibleEmailThreadWhere } from "@/lib/email-visibility";
import {
  matterAccessWhere,
  optionalRecordAccessClause,
} from "@/lib/matter-access";
import { TASK_CLOSED_STATUSES } from "@/lib/constants/task-status";
import {
  dateOnlyRange,
  daysUntilDateOnly,
  todayKey,
} from "@/lib/format-date";
import { MISSING_SIGNED_AGREEMENT_WHERE } from "@/lib/queries/agreement-missing";

export const TRIAGE_GROUP_LIMIT = 5;

export type TriageGroupKey =
  | "deadlines"
  | "tasks"
  | "email"
  | "uploads"
  | "agreements";

export type TriageRow = {
  id: string;
  title: string;
  /** Second line: usually the matter name. */
  context: string | null;
  /** Null for a firm-wide task, which has no page to open. */
  href: string | null;
  /** Date-only due date + countdown from the viewer's today (negative =
   *  overdue); both null for rows that have no due date. */
  dueDate: Date | null;
  days: number | null;
};

export type TriageGroup = {
  key: TriageGroupKey;
  label: string;
  rows: TriageRow[];
  /** Exact number of matching items, including those past the cap. */
  total: number;
  /** `total - rows.length`: the "+N more" count. */
  hidden: number;
};

export type TriageData = { groups: TriageGroup[] };

function group(
  key: TriageGroupKey,
  label: string,
  rows: TriageRow[],
  total: number,
): TriageGroup | null {
  if (total === 0) return null;
  return { key, label, rows, total, hidden: Math.max(0, total - rows.length) };
}

export async function getTriage(tz: string): Promise<TriageData> {
  const userId = await getCurrentUserId();
  const today = todayKey(tz);
  // Due today or earlier = strictly before the start of tomorrow.
  const dueBefore = dateOnlyRange(today, today).lt;

  const [wallMatter, canViewPortal, isAdmin] = await Promise.all([
    matterAccessWhere(userId),
    currentUserHasPermission("portal.view"),
    isCurrentUserAdmin(),
  ]);
  const openMatter = { ...wallMatter, isArchived: false };

  const deadlinesP = (async () => {
    // "Me": deadlines I own, plus unowned ones on matters I'm on the
    // team of (someone has to catch those). Legacy rows can carry a
    // stored "overdue" status (deadline-status.ts) and are still live.
    const where = {
      status: { in: ["open", "overdue"] },
      dueDate: { lt: dueBefore },
      matter: openMatter,
      OR: [
        { ownerId: userId },
        {
          ownerId: null,
          matter: { teamMembers: { some: { userId, removedAt: null } } },
        },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.deadline.findMany({
        where,
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        take: TRIAGE_GROUP_LIMIT,
        select: {
          id: true,
          title: true,
          dueDate: true,
          matterId: true,
          matter: { select: { name: true } },
        },
      }),
      prisma.deadline.count({ where }),
    ]);
    return group(
      "deadlines",
      "Deadlines",
      rows.map((d) => ({
        id: d.id,
        title: d.title,
        context: d.matter.name,
        href: `/matters/${d.matterId}/deadlines`,
        dueDate: d.dueDate,
        days: daysUntilDateOnly(d.dueDate, tz),
      })),
      total,
    );
  })();

  const tasksP = (async () => {
    const where = {
      ownerId: userId,
      status: { notIn: [...TASK_CLOSED_STATUSES] },
      dueDate: { lt: dueBefore },
      AND: [
        ...(await optionalRecordAccessClause(userId)),
        // Same rule as the deadlines group: archived matters are done.
        { OR: [{ matterId: null }, { matter: { isArchived: false } }] },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        take: TRIAGE_GROUP_LIMIT,
        select: {
          id: true,
          title: true,
          dueDate: true,
          matterId: true,
          matter: { select: { name: true } },
          leadId: true,
          lead: { select: { name: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);
    return group(
      "tasks",
      "Your tasks",
      rows.map((t) => ({
        id: t.id,
        title: t.title,
        context:
          t.matter?.name ?? (t.lead ? `Intake · ${t.lead.name}` : null),
        href: t.matterId
          ? `/matters/${t.matterId}/tasks`
          : t.leadId
            ? `/intake/${t.leadId}/tasks`
            : null,
        dueDate: t.dueDate,
        days: t.dueDate ? daysUntilDateOnly(t.dueDate, tz) : null,
      })),
      total,
    );
  })();

  const emailP = (async () => {
    const where = {
      ...visibleEmailThreadWhere(userId),
      isRead: false,
      isArchived: false,
      matterId: { not: null },
      matter: wallMatter,
    };
    const [rows, total] = await Promise.all([
      prisma.emailThread.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        take: TRIAGE_GROUP_LIMIT,
        select: {
          id: true,
          subject: true,
          matter: { select: { name: true } },
        },
      }),
      prisma.emailThread.count({ where }),
    ]);
    return group(
      "email",
      "Unread email on matters",
      rows.map((t) => ({
        id: t.id,
        title: t.subject,
        context: t.matter?.name ?? null,
        href: `/communication?view=email&thread=${t.id}`,
        dueDate: null,
        days: null,
      })),
      total,
    );
  })();

  const uploadsP = canViewPortal
    ? (async () => {
        const where = { status: "submitted", matter: openMatter };
        const [rows, total] = await Promise.all([
          prisma.documentRequest.findMany({
            where,
            orderBy: { updatedAt: "asc" },
            take: TRIAGE_GROUP_LIMIT,
            select: {
              id: true,
              title: true,
              matterId: true,
              matter: { select: { name: true } },
            },
          }),
          prisma.documentRequest.count({ where }),
        ]);
        return group(
          "uploads",
          "Client uploads to review",
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            context: r.matter.name,
            href: `/matters/${r.matterId}`,
            dueDate: null,
            days: null,
          })),
          total,
        );
      })()
    : Promise.resolve(null);

  const agreementsP = isAdmin
    ? (async () => {
        const owner = await prisma.user.findUnique({
          where: { id: userId },
          select: { firm: { select: { requireOriginatingDoc: true } } },
        });
        if (!owner?.firm?.requireOriginatingDoc) return null;
        // AND, not spread: both fragments may carry an `OR`.
        const where = { AND: [MISSING_SIGNED_AGREEMENT_WHERE, wallMatter] };
        const [rows, total] = await Promise.all([
          prisma.matter.findMany({
            where,
            orderBy: { createdAt: "asc" },
            take: TRIAGE_GROUP_LIMIT,
            select: { id: true, name: true },
          }),
          prisma.matter.count({ where }),
        ]);
        return group(
          "agreements",
          "Missing signed agreement",
          rows.map((m) => ({
            id: m.id,
            title: m.name,
            context: null,
            href: `/matters/${m.id}`,
            dueDate: null,
            days: null,
          })),
          total,
        );
      })()
    : Promise.resolve(null);

  const all = await Promise.all([
    deadlinesP,
    tasksP,
    emailP,
    uploadsP,
    agreementsP,
  ]);
  return { groups: all.filter((g): g is TriageGroup => g !== null) };
}
