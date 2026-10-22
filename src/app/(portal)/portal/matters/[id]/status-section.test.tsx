import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusSection } from "./status-section";

const u = (over: Partial<Parameters<typeof StatusSection>[0]["updates"][0]>) => ({
  id: "u1",
  stageLabel: "Discovery",
  body: "We filed.",
  postedAt: new Date("2026-10-15T18:00:00Z"),
  edited: false,
  ...over,
});

describe("StatusSection", () => {
  test("empty state", () => {
    render(<StatusSection updates={[]} />);
    expect(screen.getByText("Where things stand")).toBeTruthy();
    expect(screen.getByText("Your legal team hasn't posted an update yet.")).toBeTruthy();
    expect(screen.queryByText("Earlier updates")).toBeNull();
  });

  test("latest update with stage, date and earlier list", () => {
    render(
      <StatusSection
        updates={[
          u({ id: "a", stageLabel: "Mediation", body: "Newest body" }),
          u({ id: "b", stageLabel: "Filed", body: "Old body" }),
        ]}
      />,
    );
    expect(screen.getByText("Mediation")).toBeTruthy();
    expect(screen.getByText("Newest body")).toBeTruthy();
    expect(screen.getByText("Updated Oct 15, 2026")).toBeTruthy();
    expect(screen.getByText("Earlier updates")).toBeTruthy();
    expect(screen.getByText("Old body")).toBeTruthy();
  });

  test("line breaks preserved and HTML rendered literally", () => {
    render(<StatusSection updates={[u({ body: "<b>x</b>\nline two" })]} />);
    const p = screen.getByText(/line two/);
    expect(p.textContent).toBe("<b>x</b>\nline two");
    expect(p.className).toContain("whitespace-pre-line");
    expect(p.querySelector("b")).toBeNull();
  });

  test("marks edited updates", () => {
    render(<StatusSection updates={[u({ edited: true })]} />);
    expect(screen.getByText(/\(edited\)/)).toBeTruthy();
  });
});
