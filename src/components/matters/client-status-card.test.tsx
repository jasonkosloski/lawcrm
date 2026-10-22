import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock("@/app/actions/portal-status", () => ({
  postStatusUpdate: vi.fn(async () => ({ ok: true })),
  editStatusUpdate: vi.fn(async () => ({ ok: true })),
  deleteStatusUpdate: vi.fn(async () => ({ ok: true })),
}));

import {
  deleteStatusUpdate,
  editStatusUpdate,
  postStatusUpdate,
} from "@/app/actions/portal-status";
import { confirmAction, notifyError } from "@/lib/feedback";
import { ClientStatusCard } from "./client-status-card";
import type { ClientStatusUpdateRow } from "@/lib/queries/portal-status";

const upd = (over: Partial<ClientStatusUpdateRow>): ClientStatusUpdateRow => ({
  id: "s1",
  stageLabel: "Discovery",
  body: "Waiting on records.",
  postedAt: new Date("2026-10-02T15:00:00Z"),
  editedAt: null,
  emailedAt: null,
  postedByName: "Pat Lawyer",
  ...over,
});

const renderCard = (over: Partial<React.ComponentProps<typeof ClientStatusCard>> = {}) =>
  render(
    <ClientStatusCard
      matterId="m1"
      data={{
        updates: [
          upd({ id: "s2", stageLabel: "Mediation", body: "Mediation set." }),
          upd({ id: "s1" }),
        ],
        hasLiveAccess: true,
      }}
      canAdd
      canEdit
      canDelete
      tz="America/Denver"
      {...over}
    />,
  );

beforeEach(() => vi.clearAllMocks());

describe("ClientStatusCard", () => {
  test("shows the latest update and an N earlier disclosure", async () => {
    renderCard();
    expect(screen.getByText("Mediation set.")).toBeTruthy();
    expect(screen.queryByText("Waiting on records.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "1 earlier" }));
    expect(screen.getByText("Waiting on records.")).toBeTruthy();
  });

  test("hides Post update without portal.add_updates", () => {
    renderCard({ canAdd: false });
    expect(screen.queryByRole("button", { name: "Post update" })).toBeNull();
  });

  test("prefills the stage from the latest update, email ticked by default", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect((screen.getByLabelText("Stage") as HTMLInputElement).value).toBe("Mediation");
    expect((screen.getByLabelText(/Email the client/) as HTMLInputElement).checked).toBe(true);
    await userEvent.type(screen.getByLabelText("What's next"), "Hi");
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Post update",
      }),
    );
    await waitFor(() =>
      expect(postStatusUpdate).toHaveBeenCalledWith("m1", {
        stageLabel: "Mediation",
        body: "Hi",
        emailClient: true,
      }),
    );
  });

  test("shows the no-access hint when nobody has live access", () => {
    renderCard({ data: { updates: [], hasLiveAccess: false } });
    expect(screen.getByText("No one has portal access on this matter yet.")).toBeTruthy();
  });

  test("a warning result is shown as an inline notice", async () => {
    vi.mocked(postStatusUpdate).mockResolvedValueOnce({
      ok: true,
      warning: "Posted, but the email could not be sent.",
    });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Post update" }));
    await userEvent.type(screen.getByLabelText("What's next"), "Hi");
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Post update",
      }),
    );
    expect(await screen.findByText("Posted, but the email could not be sent.")).toBeTruthy();
  });

  test("Edit opens prefilled without the email checkbox", async () => {
    renderCard();
    await userEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect((screen.getByLabelText("Stage") as HTMLInputElement).value).toBe("Mediation");
    expect(screen.queryByLabelText(/Email the client/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(editStatusUpdate).toHaveBeenCalledWith("s2", {
        stageLabel: "Mediation",
        body: "Mediation set.",
      }),
    );
  });

  test("Delete asks for confirmation first", async () => {
    renderCard();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    expect(confirmAction).toHaveBeenCalled();
    await waitFor(() => expect(deleteStatusUpdate).toHaveBeenCalledWith("s2"));
  });

  const warnOnce = async () => {
    vi.mocked(postStatusUpdate).mockResolvedValueOnce({
      ok: true,
      warning: "Posted, but the email could not be sent.",
    });
    await userEvent.click(screen.getByRole("button", { name: "Post update" }));
    await userEvent.type(screen.getByLabelText("What's next"), "Hi");
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Post update" }),
    );
    await screen.findByText("Posted, but the email could not be sent.");
  };

  test("the warning notice clears when a dialog is opened again", async () => {
    renderCard();
    await warnOnce();
    await userEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect(screen.queryByText("Posted, but the email could not be sent.")).toBeNull();
  });

  test("the warning notice clears when an update is deleted", async () => {
    renderCard();
    await warnOnce();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(deleteStatusUpdate).toHaveBeenCalledWith("s2"));
    expect(screen.queryByText("Posted, but the email could not be sent.")).toBeNull();
  });

  test("a failed delete reports the error", async () => {
    vi.mocked(deleteStatusUpdate).mockResolvedValueOnce({ ok: false, error: "Update not found." });
    renderCard();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Update not found."));
  });

  test("cancelling the delete confirmation leaves the update alone", async () => {
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    renderCard();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    expect(confirmAction).toHaveBeenCalled();
    expect(deleteStatusUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("Mediation set.")).toBeTruthy();
  });

  test("the earlier-updates toggle expands and collapses", async () => {
    renderCard();
    const toggle = screen.getByRole("button", { name: "1 earlier" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(screen.getByText("Waiting on records.")).toBeTruthy();
    const hide = screen.getByRole("button", { name: "Hide earlier" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(hide);
    expect(screen.queryByText("Waiting on records.")).toBeNull();
    expect(screen.getByRole("button", { name: "1 earlier" })).toBeTruthy();
  });
});
