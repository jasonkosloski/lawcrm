/**
 * The event modal's "Share with client" control. canShare gates the
 * buttons; the Shared badge shows to anyone with portal.view.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Res = { ok: boolean; warning?: string; error?: string };
const { shareEventWithClient, updateEventShare, stopSharingEvent } = vi.hoisted(() => ({
  shareEventWithClient: vi.fn<(...args: unknown[]) => Promise<Res>>(async () => ({ ok: true })),
  updateEventShare: vi.fn<(...args: unknown[]) => Promise<Res>>(async () => ({ ok: true })),
  stopSharingEvent: vi.fn<(...args: unknown[]) => Promise<Res>>(async () => ({ ok: true })),
}));

vi.mock("@/app/actions/portal-status", () => ({
  shareEventWithClient,
  updateEventShare,
  stopSharingEvent,
}));
vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
}));

import { EventShareSection } from "./event-share-section";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventShareSection", () => {
  test("unshared: button opens a dialog prefilled with the event title", async () => {
    const user = userEvent.setup();
    render(<EventShareSection eventId="e1" eventTitle="Hearing" canShare share={null} />);
    expect(screen.queryByText("Shared")).toBeNull();
    await user.click(screen.getByRole("button", { name: /share with client/i }));
    expect(screen.getByLabelText(/title/i)).toHaveValue("Hearing");
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(shareEventWithClient).toHaveBeenCalledWith("e1", {
      clientTitle: "Hearing",
      clientNote: undefined,
    });
  });

  test("shared: badge with Edit share and Stop sharing", async () => {
    const user = userEvent.setup();
    render(
      <EventShareSection
        eventId="e1"
        eventTitle="Hearing"
        canShare
        share={{ clientTitle: "Court date", clientNote: "Bring ID" }}
      />,
    );
    expect(screen.getByText("Shared")).toBeInTheDocument();
    expect(screen.getByText("Court date")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop sharing" }));
    expect(stopSharingEvent).toHaveBeenCalledWith("e1");
    await user.click(screen.getByRole("button", { name: "Edit share" }));
    expect(screen.getByLabelText(/title/i)).toHaveValue("Court date");
    expect(screen.getByLabelText(/note/i)).toHaveValue("Bring ID");
  });

  test("without canShare: no controls, badge still shows", () => {
    render(
      <EventShareSection
        eventId="e1"
        eventTitle="Hearing"
        canShare={false}
        share={{ clientTitle: "Court date", clientNote: null }}
      />,
    );
    expect(screen.getByText("Shared")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("without canShare and unshared: renders nothing", () => {
    const { container } = render(
      <EventShareSection eventId="e1" eventTitle="Hearing" canShare={false} share={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("the notice clears at the start of the next share submit", async () => {
    const user = userEvent.setup();
    shareEventWithClient.mockResolvedValueOnce({ ok: true, warning: "Heads up" });
    shareEventWithClient.mockResolvedValueOnce({ ok: false, error: "Nope" });
    render(<EventShareSection eventId="e1" eventTitle="Hearing" canShare share={null} />);
    await user.click(screen.getByRole("button", { name: /share with client/i }));
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByText("Heads up")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /share with client/i }));
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByText("Nope")).toBeInTheDocument();
    expect(screen.queryByText("Heads up")).toBeNull();
  });

  test("the notice clears when sharing is stopped", async () => {
    const user = userEvent.setup();
    updateEventShare.mockResolvedValueOnce({ ok: true, warning: "Heads up" });
    render(
      <EventShareSection
        eventId="e1"
        eventTitle="Hearing"
        canShare
        share={{ clientTitle: "Court date", clientNote: null }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Edit share" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Heads up")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop sharing" }));
    expect(stopSharingEvent).toHaveBeenCalledWith("e1");
    expect(screen.queryByText("Heads up")).toBeNull();
  });
});
