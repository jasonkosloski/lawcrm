/**
 * NotificationEmailSettings — per-category email mode radiogroups
 * (no Off for deadlines), optimistic saves that revert and report on
 * failure, and the muted-matters list.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/feedback", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock("@/app/actions/notification-preferences", () => ({
  setNotificationEmailMode: vi.fn(),
  setMatterEmailMute: vi.fn(),
}));

import {
  setMatterEmailMute,
  setNotificationEmailMode,
} from "@/app/actions/notification-preferences";
import { notifyError } from "@/lib/feedback";
import type { EmailMode, NotificationCategory } from "@/lib/notification-categories";
import { NotificationEmailSettings } from "./notification-email-settings";

const allInstant = {
  deadlines: "instant",
  tasks: "instant",
  settlement: "instant",
  billing: "instant",
  matter_team: "instant",
  portal: "instant",
  other: "instant",
} as Record<NotificationCategory, EmailMode>;

const renderIt = (mutedMatters: { id: string; name: string }[] = []) =>
  render(
    <NotificationEmailSettings
      modes={allInstant}
      mutedMatters={mutedMatters}
      timeZone="America/Denver"
    />,
  );

beforeEach(() => {
  vi.mocked(setNotificationEmailMode).mockReset();
  vi.mocked(setMatterEmailMute).mockReset();
  vi.mocked(notifyError).mockReset();
});

describe("NotificationEmailSettings", () => {
  test("renders a row per category", () => {
    renderIt();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(7);
    expect(screen.getByRole("radiogroup", { name: "Tasks email" })).toBeTruthy();
    expect(screen.getByText(/7:00 AM \(America\/Denver\)/)).toBeTruthy();
  });

  test("deadlines has no off option", () => {
    renderIt();
    const group = screen.getByRole("radiogroup", { name: "Deadlines email" });
    expect(within(group).queryByRole("radio", { name: "Off" })).toBeNull();
    expect(within(group).getByRole("radio", { name: "Daily digest" })).toBeTruthy();
    expect(screen.getByText("Deadline reminders can't be turned off.")).toBeTruthy();
  });

  test("choosing digest calls setNotificationEmailMode", async () => {
    vi.mocked(setNotificationEmailMode).mockResolvedValue({ ok: true });
    renderIt();
    const group = screen.getByRole("radiogroup", { name: "Tasks email" });
    fireEvent.click(within(group).getByRole("radio", { name: "Daily digest" }));
    await waitFor(() => expect(setNotificationEmailMode).toHaveBeenCalledWith("tasks", "digest"));
    expect(
      within(group).getByRole("radio", { name: "Daily digest" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  test("failure reverts and notifies", async () => {
    vi.mocked(setNotificationEmailMode).mockResolvedValue({ ok: false, error: "nope" });
    renderIt();
    const group = screen.getByRole("radiogroup", { name: "Billing email" });
    fireEvent.click(within(group).getByRole("radio", { name: "Off" }));
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith("nope"));
    await waitFor(() =>
      expect(
        within(group).getByRole("radio", { name: "Instant" }).getAttribute("aria-checked"),
      ).toBe("true"),
    );
  });

  test("unmute calls setMatterEmailMute", async () => {
    vi.mocked(setMatterEmailMute).mockResolvedValue({ ok: true, muted: false });
    renderIt([{ id: "m1", name: "Smith v. Jones" }]);
    expect(screen.getByRole("link", { name: "Smith v. Jones" }).getAttribute("href")).toBe(
      "/matters/m1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Unmute Smith v. Jones" }));
    await waitFor(() => expect(setMatterEmailMute).toHaveBeenCalledWith("m1", false));
    await waitFor(() => expect(screen.queryByText("Smith v. Jones")).toBeNull());
  });

  test("empty muted state", () => {
    renderIt();
    expect(screen.getByText("No muted matters")).toBeTruthy();
  });
});
