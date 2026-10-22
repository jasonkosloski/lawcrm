/**
 * /intake/[id]/events — composer gating, ?event= ownership guard and
 * fetch ordering (notes / time only after the event resolves visible),
 * and the converted-lead pointer.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RecordScope } from "@/lib/record-scope";
import type { MatterEventRow } from "@/lib/queries/matter-detail";

// Lead wall (ADR-049) is unit-tested in src/lib/lead-access.test.ts;
// pages are pinned to call it by src/app/page-guards.test.ts.
vi.mock("@/lib/lead-access", () => ({
  assertLeadAccess: vi.fn(async () => "u1"),
}));
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(async () => true),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { lead: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/queries/matter-detail", () => ({
  getLeadEvents: vi.fn(async () => []),
}));
vi.mock("@/lib/queries/calendar", () => ({
  getCalendarEventById: vi.fn(),
  getEventNotes: vi.fn(async () => []),
  getEventTimeEntries: vi.fn(async () => []),
}));
vi.mock("@/components/calendar/event-detail-modal", () => ({
  EventDetailModal: ({ event }: { event: { title: string } }) => (
    <div data-testid="event-detail-modal">{event.title}</div>
  ),
}));
vi.mock("@/components/matters/captures/event-composer", () => ({
  EventComposer: ({ scope }: { scope: RecordScope }) => (
    <div data-testid="event-composer" data-scope={JSON.stringify(scope)} />
  ),
}));

import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { getLeadEvents } from "@/lib/queries/matter-detail";
import { getCalendarEventById, getEventNotes } from "@/lib/queries/calendar";
import LeadEventsPage from "./page";

const ev = (over: Partial<MatterEventRow> = {}): MatterEventRow => ({
  id: "evt_1",
  title: "Consultation",
  type: "intake",
  startTime: new Date("2026-11-02T17:00:00Z"),
  endTime: new Date("2026-11-02T18:00:00Z"),
  isAllDay: false,
  location: "Office",
  zoomUrl: null,
  color: "var(--color-ink-3)",
  attendeeCount: 1,
  isUpcoming: true,
  viewerCanSeeDetails: true,
  notes: [],
  timeEntries: [],
  ...over,
});

const lead = (stage: string, convertedMatterId: string | null = null) =>
  vi.mocked(prisma.lead.findUnique).mockResolvedValue({ stage, convertedMatterId } as never);

const renderPage = async (event?: string) => {
  const ui = await LeadEventsPage({
    params: Promise.resolve({ id: "lead_1" }),
    searchParams: Promise.resolve(event ? { event } : {}),
  } as Parameters<typeof LeadEventsPage>[0]);
  return render(ui ?? <></>);
};

afterEach(() => vi.clearAllMocks());

describe("LeadEventsPage", () => {
  test("lead-scoped composer; rows link to this tab's ?event= modal", async () => {
    lead("meeting");
    vi.mocked(getLeadEvents).mockResolvedValue([ev()]);
    await renderPage();
    expect(JSON.parse(screen.getByTestId("event-composer").getAttribute("data-scope")!)).toEqual({
      kind: "lead",
      leadId: "lead_1",
    });
    expect(screen.getByRole("link", { name: /consultation/i }).getAttribute("href")).toBe(
      "/intake/lead_1/events?event=evt_1",
    );
  });

  test("no events.create: no composer", async () => {
    lead("new");
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    await renderPage();
    expect(screen.queryByTestId("event-composer")).toBeNull();
  });

  test("?event= for an event not on this lead opens nothing and fetches nothing", async () => {
    lead("new");
    vi.mocked(getLeadEvents).mockResolvedValue([ev()]);
    await renderPage("evt_elsewhere");
    expect(getCalendarEventById).not.toHaveBeenCalled();
    expect(screen.queryByTestId("event-detail-modal")).toBeNull();
  });

  test("a Busy event opens its shell but its notes are never fetched", async () => {
    lead("new");
    vi.mocked(getLeadEvents).mockResolvedValue([ev()]);
    vi.mocked(getCalendarEventById).mockResolvedValue({
      title: "Busy",
      viewerCanSeeDetails: false,
    } as never);
    await renderPage("evt_1");
    expect(screen.getByTestId("event-detail-modal").textContent).toBe("Busy");
    expect(getEventNotes).not.toHaveBeenCalled();
  });

  test("converted lead: pointer to the matter's events, no composer", async () => {
    lead("converted", "m_9");
    await renderPage();
    expect(screen.queryByTestId("event-composer")).toBeNull();
    expect(screen.getByRole("link", { name: /open matter events/i }).getAttribute("href")).toBe(
      "/matters/m_9/events",
    );
  });
});
