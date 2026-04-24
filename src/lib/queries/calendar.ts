/**
 * Calendar Queries
 *
 * Fetch calendar events + deadlines that fall within a date range,
 * shaped for the week/month views. Both are rendered together —
 * deadlines are time-less (due by end-of-day) and get distinct
 * visual treatment.
 */

import { prisma } from "@/lib/prisma";

export type CalendarEventRow = {
  id: string;
  kind: "event";
  title: string;
  type: string;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  location: string | null;
  /** Matter color if the event is linked to a matter; fallback ink-3. */
  color: string;
  matterId: string | null;
  matterName: string | null;
};

export type CalendarDeadlineRow = {
  id: string;
  kind: "deadline";
  title: string;
  dueDate: Date;
  /** `critical` / `auto_rule` / `manual` — drives the chip color. */
  deadlineKind: string;
  status: string;
  matterId: string;
  matterName: string;
};

export type CalendarItem = CalendarEventRow | CalendarDeadlineRow;

export async function getCalendarItems(
  rangeStart: Date,
  rangeEnd: Date
): Promise<CalendarItem[]> {
  const [events, deadlines] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: {
        startTime: { gte: rangeStart, lte: rangeEnd },
      },
      include: {
        matter: { select: { id: true, name: true, color: true } },
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.deadline.findMany({
      where: {
        dueDate: { gte: rangeStart, lte: rangeEnd },
        status: "open",
      },
      include: {
        matter: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  const mappedEvents: CalendarItem[] = events.map((e) => ({
    id: e.id,
    kind: "event",
    title: e.title,
    type: e.type,
    startTime: e.startTime,
    endTime: e.endTime,
    isAllDay: e.isAllDay,
    location: e.location,
    color: e.matter?.color ?? e.color ?? "var(--color-ink-3)",
    matterId: e.matter?.id ?? null,
    matterName: e.matter?.name ?? null,
  }));

  const mappedDeadlines: CalendarItem[] = deadlines.map((d) => ({
    id: d.id,
    kind: "deadline",
    title: d.title,
    dueDate: d.dueDate,
    deadlineKind: d.kind,
    status: d.status,
    matterId: d.matter.id,
    matterName: d.matter.name,
  }));

  return [...mappedEvents, ...mappedDeadlines];
}

/** Summary counts for the top-bar crumb. */
export async function getCalendarSummary(
  rangeStart: Date,
  rangeEnd: Date
): Promise<{
  events: number;
  deadlines: number;
  criticalDeadlines: number;
}> {
  const [events, deadlines, critical] = await Promise.all([
    prisma.calendarEvent.count({
      where: { startTime: { gte: rangeStart, lte: rangeEnd } },
    }),
    prisma.deadline.count({
      where: {
        dueDate: { gte: rangeStart, lte: rangeEnd },
        status: "open",
      },
    }),
    prisma.deadline.count({
      where: {
        dueDate: { gte: rangeStart, lte: rangeEnd },
        status: "open",
        kind: "critical",
      },
    }),
  ]);
  return { events, deadlines, criticalDeadlines: critical };
}
