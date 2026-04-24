/**
 * Calendar Page
 *
 * Week view (default) and Month view, both read-only for now. State
 * lives in the URL: `?view=week|month` and `?d=YYYY-MM-DD`. No
 * external-calendar integration yet — this is the internal view of
 * CalendarEvents + Deadlines stored in the DB.
 */

import Link from "next/link";
import { Plus } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import {
  CalendarToolbar,
  monthGridRange,
  weekRange,
} from "@/components/calendar/calendar-toolbar";
import { WeekView } from "@/components/calendar/week-view";
import { MonthView } from "@/components/calendar/month-view";
import { parseCalendarParams } from "@/lib/calendar-utils";
import {
  getCalendarItems,
  getCalendarSummary,
} from "@/lib/queries/calendar";

export default async function CalendarPage({
  searchParams,
}: PageProps<"/calendar">) {
  const sp = await searchParams;
  const { view, focal } = parseCalendarParams(sp);

  const range =
    view === "week" ? weekRange(focal) : monthGridRange(focal);

  const [items, summary] = await Promise.all([
    getCalendarItems(range.start, range.end),
    getCalendarSummary(range.start, range.end),
  ]);

  const crumbBits = [
    `${summary.events} events`,
    `${summary.deadlines} deadlines`,
    summary.criticalDeadlines > 0
      ? `${summary.criticalDeadlines} critical`
      : null,
  ].filter(Boolean);

  return (
    <>
      <TopBar
        title="Calendar"
        crumbs={crumbBits.join(" · ")}
        actions={
          <Button size="sm" render={<Link href="/calendar/new" />}>
            <Plus />
            New event
          </Button>
        }
      />

      <div className="flex-1 flex flex-col min-h-0 animate-page-enter">
        <CalendarToolbar view={view} focal={focal} />
        {view === "week" ? (
          <WeekView focal={focal} items={items} />
        ) : (
          <MonthView focal={focal} items={items} />
        )}
      </div>
    </>
  );
}
