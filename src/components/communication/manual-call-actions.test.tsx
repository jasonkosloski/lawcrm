/**
 * ManualCallActions: a thrown deleteCallLog must toast rather than
 * escape the async transition (which would swap the whole page for
 * the error boundary).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { deleteCallLog } = vi.hoisted(() => ({ deleteCallLog: vi.fn() }));
vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock("@/app/actions/calls", () => ({
  deleteCallLog,
  logCall: vi.fn(),
  updateCallLog: vi.fn(),
}));

import type { EditableCallLog } from "@/lib/call-log-form";
import { confirmAction, notifyError } from "@/lib/feedback";
import { ManualCallActions } from "./manual-call-actions";

const item: EditableCallLog = {
  id: "item-1",
  contactLabel: "Dana Client",
  direction: "outbound",
  outcome: "answered",
  occurredAt: new Date("2026-06-10T20:30:00Z"),
  durationSec: 300,
  matterId: null,
  matterName: null,
  summary: null,
};

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  deleteCallLog.mockReset();
});

async function clickDelete() {
  const user = setupUser();
  await user.click(screen.getByRole("button", { name: "Call log actions" }));
  await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
}

describe("ManualCallActions delete", () => {
  test("a thrown action toasts instead of escaping", async () => {
    deleteCallLog.mockImplementation(async () => {
      throw new Error("db down");
    });
    render(<ManualCallActions item={item} canEdit canDelete />);
    await clickDelete();

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        expect.stringMatching(/try again/i)
      )
    );
  });

  test("a refusal returned by the action is surfaced verbatim", async () => {
    deleteCallLog.mockResolvedValue({ ok: false, error: "Provider item" });
    render(<ManualCallActions item={item} canEdit canDelete />);

    await clickDelete();

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Provider item"));
  });

  test("declining the confirm never calls the action", async () => {
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    render(<ManualCallActions item={item} canEdit canDelete />);

    await clickDelete();

    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("Dana Client") })
    );
    expect(deleteCallLog).not.toHaveBeenCalled();
  });

  test("renders nothing without edit or delete permission", () => {
    const { container } = render(
      <ManualCallActions item={item} canEdit={false} canDelete={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
