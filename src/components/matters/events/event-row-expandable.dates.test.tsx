/**
 * EventRowExpandable — date/time rendering and note previews.
 *
 * The row is a client component that is ALSO server-rendered. Its
 * times must come from the viewer's PROFILE zone (not the runtime's)
 * so the server HTML and the hydrated client agree, and all-day
 * events are date-only values that never shift a day.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/calendar/event-link", () => ({
  EventLink: ({ children }: { children: React.ReactNode }) => (
    <a>{children}</a>
  ),
}));
vi.mock("@/components/calendar/event-notes-section", () => ({
  EventNotesSection: () => null,
}));
vi.mock("@/components/calendar/event-time-entries-section", () => ({
  EventTimeEntriesSection: () => null,
}));

import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { parseDateOnly } from "@/lib/format-date";
import type { MatterEventRow } from "@/lib/queries/matter-detail";
import { EventRowExpandable, notePreview } from "./event-row-expandable";

const base: MatterEventRow = {
  id: "e1",
  title: "Hearing",
  type: "hearing",
  // 2026-07-10 15:00-16:00Z = 9:00-10:00 AM in Denver, midnight-ish
  // in Tokyo (Jul 11, 12:00-1:00 AM).
  startTime: new Date("2026-07-10T15:00:00Z"),
  endTime: new Date("2026-07-10T16:00:00Z"),
  isAllDay: false,
  location: null,
  zoomUrl: null,
  color: "var(--color-ink-3)",
  attendeeCount: 0,
  isUpcoming: true,
  viewerCanSeeDetails: true,
  notes: [],
  timeEntries: [],
};

afterEach(cleanup);

function renderRow(event: MatterEventRow, tz: string) {
  return render(
    <UserTimeZoneProvider timeZone={tz}>
      <ul>
        <EventRowExpandable event={event} matterId="m1" matterName="Smith" />
      </ul>
    </UserTimeZoneProvider>
  );
}

describe("EventRowExpandable — times", () => {
  test("renders the time range in the viewer's profile zone", () => {
    renderRow(base, "America/Denver");
    expect(screen.getByText("9:00 AM – 10:00 AM")).toBeTruthy();
    expect(screen.getByText("Fri, Jul 10")).toBeTruthy();
  });

  test("the weekday follows the profile zone across midnight", () => {
    renderRow(base, "Asia/Tokyo");
    expect(screen.getByText("12:00 AM – 1:00 AM")).toBeTruthy();
    expect(screen.getByText("Sat, Jul 11")).toBeTruthy();
  });

  test("a same-day check uses the viewer's day, not the runtime's", () => {
    // 04:00-07:00Z on Jul 11 is Jul 10 10 PM - Jul 11 1 AM in Denver:
    // it crosses the viewer's midnight, so both ends show dates.
    renderRow(
      {
        ...base,
        startTime: new Date("2026-07-11T04:00:00Z"),
        endTime: new Date("2026-07-11T07:00:00Z"),
      },
      "America/Denver"
    );
    expect(screen.getByText("Jul 10, 10:00 PM – Jul 11, 1:00 AM")).toBeTruthy();
  });

  test("an all-day event shows its stored date in every zone", () => {
    const allDay = {
      ...base,
      isAllDay: true,
      startTime: parseDateOnly("2026-07-08")!,
      endTime: parseDateOnly("2026-07-08")!,
    };
    for (const tz of ["America/Denver", "UTC", "Asia/Tokyo"]) {
      const { unmount } = renderRow(allDay, tz);
      expect(screen.getByText("Wed, Jul 8")).toBeTruthy();
      expect(screen.getByText("All day")).toBeTruthy();
      unmount();
    }
  });

  test("the hours chip shows quarter hours exactly", () => {
    renderRow(
      {
        ...base,
        timeEntries: [
          { hours: 0.25 },
          { hours: 0.5 },
        ] as MatterEventRow["timeEntries"],
      },
      "America/Denver"
    );
    expect(screen.getByText("0.75h")).toBeTruthy();
  });
});

describe("notePreview", () => {
  const preview = (content: string) =>
    notePreview({ content, authorInitials: "JK" });

  test("decodes the entities the sanitizer escapes", () => {
    expect(preview("<p>Met w/ Smith &amp; Wesson counsel</p>")).toBe(
      "JK: Met w/ Smith & Wesson counsel"
    );
    expect(preview("<p>5 &lt; 6 &gt; 4 &quot;ok&quot; it&#39;s</p>")).toBe(
      `JK: 5 < 6 > 4 "ok" it's`
    );
  });

  test("decodes &amp; last so an escaped entity stays literal text", () => {
    expect(preview("<p>&amp;lt;b&amp;gt;</p>")).toBe("JK: &lt;b&gt;");
  });

  test("still strips tags and collapses whitespace", () => {
    expect(preview("<p>One</p><p>Two&nbsp;&nbsp;three</p>")).toBe(
      "JK: One Two three"
    );
  });

  test("truncates long previews", () => {
    const out = preview(`<p>${"word ".repeat(60)}</p>`);
    expect(out.endsWith("…")).toBe(true);
  });
});
