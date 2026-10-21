/**
 * Staff Portal channel: thread render, composer, mark-read on mount.
 * Server actions are mocked; their DB behavior is covered by
 * portal-messages action tests.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortalConversation } from "./portal-conversation";

vi.mock("@/app/actions/portal-messages", () => ({
  sendStaffPortalMessage: vi.fn(),
  markStaffPortalThreadRead: vi.fn().mockResolvedValue(undefined),
}));

import {
  markStaffPortalThreadRead,
  sendStaffPortalMessage,
} from "@/app/actions/portal-messages";

const mockedSend = vi.mocked(sendStaffPortalMessage);
const mockedMark = vi.mocked(markStaffPortalThreadRead);

const conversation = (over: Partial<Parameters<typeof PortalConversation>[0]["conversation"]> = {}) => ({
  messages: [
    {
      id: "m1",
      body: "Hello <b>x</b>\nsecond line",
      createdAt: new Date("2026-10-20T15:00:00Z"),
      fromClient: true,
      authorName: "Carla Client",
    },
    {
      id: "m2",
      body: "We got it",
      createdAt: new Date("2026-10-20T16:00:00Z"),
      fromClient: false,
      authorName: "Sam Staff",
    },
  ],
  hasLiveAccess: true,
  unread: 1,
  ...over,
});

const setup = (
  over: Partial<Parameters<typeof PortalConversation>[0]> = {}
) =>
  render(
    <PortalConversation
      matterId="matter_1"
      conversation={conversation()}
      canSend
      tz="America/Denver"
      {...over}
    />
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockedMark.mockResolvedValue(undefined);
});

describe("PortalConversation", () => {
  test("renders names oldest first, body literal with line breaks, client marker", () => {
    setup();
    const names = screen.getAllByTestId("portal-author").map((n) => n.textContent);
    expect(names).toEqual(["Carla Client", "Sam Staff"]);
    const body = screen.getByText(/Hello <b>x<\/b>/);
    expect(body.textContent).toBe("Hello <b>x</b>\nsecond line");
    expect(body.className).toContain("whitespace-pre-line");
    expect(body.querySelector("b")).toBeNull();
    expect(screen.getAllByText("Client")).toHaveLength(1);
  });

  test("shows times in the viewer's zone", () => {
    setup();
    // 15:00Z is 9:00 AM in Denver (MDT, UTC-6).
    expect(screen.getByText(/9:00 AM/)).toBeInTheDocument();
  });

  test("hint appears only when nobody has live portal access", () => {
    const { unmount } = setup();
    expect(
      screen.queryByText("No one has portal access on this matter yet.")
    ).not.toBeInTheDocument();
    unmount();
    setup({ conversation: conversation({ hasLiveAccess: false }) });
    expect(
      screen.getByText("No one has portal access on this matter yet.")
    ).toBeInTheDocument();
  });

  test("composer is hidden without canSend", () => {
    setup({ canSend: false });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  test("marks the thread read once on mount", () => {
    setup();
    expect(mockedMark).toHaveBeenCalledTimes(1);
    expect(mockedMark).toHaveBeenCalledWith("matter_1");
  });

  test("Send is disabled for an empty draft", async () => {
    setup();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "  ");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("ok clears the draft and shows a warning notice", async () => {
    mockedSend.mockResolvedValue({ ok: true, warning: "Email not sent" });
    setup();
    await userEvent.type(screen.getByRole("textbox"), "Hi there");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
    expect(mockedSend).toHaveBeenCalledWith("matter_1", "Hi there");
    expect(screen.getByRole("status")).toHaveTextContent("Email not sent");
  });

  test("error keeps the draft and shows the error", async () => {
    mockedSend.mockResolvedValue({ ok: false, error: "Nope" });
    setup();
    await userEvent.type(screen.getByRole("textbox"), "Hi there");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Nope"));
    expect(screen.getByRole("textbox")).toHaveValue("Hi there");
  });

  test("Enter inserts a newline and does not send", async () => {
    setup();
    await userEvent.type(screen.getByRole("textbox"), "a{Enter}b");
    expect(screen.getByRole("textbox")).toHaveValue("a\nb");
    expect(mockedSend).not.toHaveBeenCalled();
  });
});
