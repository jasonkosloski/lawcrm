/**
 * EmailMuteToggle — sends the mute state the user clicked toward and
 * reports failures instead of throwing (mirrors PinToggle).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/feedback", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock("@/app/actions/notification-preferences", () => ({
  setMatterEmailMute: vi.fn(),
}));

import { setMatterEmailMute } from "@/app/actions/notification-preferences";
import { notifyError } from "@/lib/feedback";
import { EmailMuteToggle } from "./email-mute-toggle";

const mockedSet = vi.mocked(setMatterEmailMute);

beforeEach(() => {
  mockedSet.mockReset();
  vi.mocked(notifyError).mockReset();
});

describe("EmailMuteToggle", () => {
  test("shows muted state", () => {
    render(<EmailMuteToggle matterId="m1" initialMuted />);
    const btn = screen.getByRole("button", {
      name: "Unmute email notifications for this matter",
    });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  test("click mutes explicitly", async () => {
    mockedSet.mockResolvedValue({ ok: true, muted: true });
    render(<EmailMuteToggle matterId="m1" initialMuted={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Mute email notifications for this matter" }),
    );
    await waitFor(() => expect(mockedSet).toHaveBeenCalledWith("m1", true));
  });

  test("failure notifies", async () => {
    mockedSet.mockResolvedValue({ ok: false, muted: false, error: "nope" });
    render(<EmailMuteToggle matterId="m1" initialMuted={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Mute email notifications for this matter" }),
    );
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith("nope"));
  });

  test("thrown action notifies", async () => {
    mockedSet.mockRejectedValue(new Error("network"));
    render(<EmailMuteToggle matterId="m1" initialMuted />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });
});
