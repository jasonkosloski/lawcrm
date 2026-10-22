import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventsSection } from "./events-section";

const ev = (over: Record<string, unknown>) => ({
  id: "e1",
  title: "Deposition prep",
  note: null,
  startTime: new Date("2026-11-03T16:00:00Z"), // 9:00 AM MST
  endTime: new Date("2026-11-03T17:30:00Z"),
  isAllDay: false,
  location: null,
  ...over,
});

describe("EventsSection", () => {
  test("renders nothing when no events", () => {
    const { container } = render(<EventsSection upcoming={[]} past={[]} />);
    expect(container.innerHTML).toBe("");
  });

  test("timed event shows date, times in Denver, location and note", () => {
    render(
      <EventsSection
        upcoming={[ev({ location: "Our office", note: "Bring ID\nand notes" })]}
        past={[]}
      />,
    );
    expect(screen.getByText("Coming up")).toBeTruthy();
    expect(screen.getByText("Deposition prep")).toBeTruthy();
    expect(screen.getByText(/Tue, Nov 3, 2026, 9:00 AM to 10:30 AM/)).toBeTruthy();
    expect(screen.getByText("Our office")).toBeTruthy();
    expect(screen.getByText(/Bring ID/).className).toContain("whitespace-pre-line");
  });

  test("all-day event shows the date only and never shifts the day", () => {
    render(
      <EventsSection
        upcoming={[
          ev({
            isAllDay: true,
            startTime: new Date("2026-11-03T00:00:00Z"),
            endTime: new Date("2026-11-03T00:00:00Z"),
          }),
        ]}
        past={[]}
      />,
    );
    expect(screen.getByText("Tue, Nov 3, 2026")).toBeTruthy();
  });

  test("a multi-day all-day event shows the first and last day", () => {
    render(
      <EventsSection
        upcoming={[
          ev({
            isAllDay: true,
            startTime: new Date("2026-11-03T00:00:00Z"),
            endTime: new Date("2026-11-05T00:00:00Z"),
          }),
        ]}
        past={[]}
      />,
    );
    expect(screen.getByText("Tue, Nov 3, 2026 to Thu, Nov 5, 2026")).toBeTruthy();
  });

  test("a timed event ending on another day shows both dates", () => {
    render(
      <EventsSection
        upcoming={[
          ev({
            startTime: new Date("2026-11-03T16:00:00Z"), // Nov 3, 9:00 AM MST
            endTime: new Date("2026-11-04T17:00:00Z"), // Nov 4, 10:00 AM MST
          }),
        ]}
        past={[]}
      />,
    );
    expect(
      screen.getByText("Tue, Nov 3, 2026, 9:00 AM to Wed, Nov 4, 2026, 10:00 AM"),
    ).toBeTruthy();
  });

  test("past events sit in a collapsed Past group; text is literal", () => {
    const { container } = render(
      <EventsSection upcoming={[]} past={[ev({ id: "p", title: "<i>Old</i>" })]} />,
    );
    expect(screen.getByText("Past")).toBeTruthy();
    expect(screen.getByText("<i>Old</i>")).toBeTruthy();
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(false);
  });
});
