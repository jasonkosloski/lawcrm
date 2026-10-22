import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";

import { DashboardCard, DashboardRow, LatePill } from "./dashboard-card";

describe("DashboardCard", () => {
  test("renders title and count", () => {
    render(
      <DashboardCard title="Deadlines" count={7}>
        <p>body</p>
      </DashboardCard>,
    );
    expect(screen.getByText("Deadlines")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("body")).toBeTruthy();
  });

  test("renders the warn text as a danger pill", () => {
    render(<DashboardCard title="T" warn="3 overdue" />);
    expect(screen.getByText("3 overdue").className).toContain("bg-danger-soft");
  });

  test("view all link is named after its card", () => {
    render(<DashboardCard title="Deadlines" viewAllHref="/x" />);
    expect(screen.getByRole("link", { name: "View all Deadlines" })).toBeTruthy();
  });

  test("view all link present with href, absent otherwise", () => {
    const { rerender } = render(<DashboardCard title="T" viewAllHref="/calendar?show=deadlines" />);
    expect(screen.getByRole("link", { name: /view all/i }).getAttribute("href")).toBe(
      "/calendar?show=deadlines",
    );
    rerender(<DashboardCard title="T" />);
    expect(screen.queryByRole("link", { name: /view all/i })).toBeNull();
  });

  test("empty state replaces children", () => {
    render(
      <DashboardCard title="T" empty={{ icon: Inbox, text: "Nothing here" }}>
        <p>kids</p>
      </DashboardCard>,
    );
    expect(screen.getByText("Nothing here")).toBeTruthy();
    expect(screen.queryByText("kids")).toBeNull();
  });

  test("wrapper has data-slot", () => {
    const { container } = render(<DashboardCard title="T" />);
    expect(container.querySelector('[data-slot="dashboard-card"]')).toBeTruthy();
  });
});

describe("DashboardRow", () => {
  test("link when href given", () => {
    render(<DashboardRow href="/x">row</DashboardRow>);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/x");
  });
  test("not a link without href", () => {
    render(<DashboardRow>row</DashboardRow>);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("LatePill", () => {
  test("renders children with tone classes", () => {
    render(<LatePill tone="danger">2d late</LatePill>);
    expect(screen.getByText("2d late").className).toContain("bg-danger-soft");
  });
});
