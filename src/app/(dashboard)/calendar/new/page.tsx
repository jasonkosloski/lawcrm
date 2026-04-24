/**
 * New Calendar Event — placeholder
 *
 * The real event-create form is a Phase 5 follow-up (needs: title +
 * type picker, start/end with all-day toggle, matter picker, location
 * or video link, attendee list, recurrence, Google Calendar sync).
 * Route exists now so the "New event" button in the calendar header
 * goes somewhere useful.
 */

import Link from "next/link";
import { TopBar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NewEventPage() {
  return (
    <>
      <TopBar title="New event" crumbs="Calendar / New" />
      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <div className="max-w-2xl">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Event form coming
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ul className="flex flex-col gap-1.5 text-xs text-ink-2 list-disc pl-4">
                <li>Title + type (meeting / deposition / hearing / mediation / block_time / trial)</li>
                <li>Start + end time, or all-day toggle</li>
                <li>Matter picker (optional — firm-wide events skip this)</li>
                <li>Location or Zoom link</li>
                <li>Attendees (team-member picker + external emails)</li>
                <li>Color override (defaults to matter's practice-area color)</li>
                <li>Recurrence rules (later)</li>
                <li>Google Calendar sync (later — Phase 5 integration)</li>
              </ul>
              <div className="mt-4 pt-3 border-t border-line text-2xs text-ink-4">
                For now events are seeded or created via Prisma Studio.
              </div>
              <div className="mt-3">
                <Link
                  href="/calendar"
                  className="text-xs text-brand-700 hover:underline"
                >
                  ← Back to calendar
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
