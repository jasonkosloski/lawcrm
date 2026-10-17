/**
 * ManualCallActions: a thrown deleteCallLog must alert rather than
 * escape the async transition (which would swap the whole page for
 * the error boundary).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { deleteCallLog } = vi.hoisted(() => ({ deleteCallLog: vi.fn() }));
vi.mock("@/app/actions/calls", () => ({
  deleteCallLog,
  logCall: vi.fn(),
  updateCallLog: vi.fn(),
}));

import type { EditableCallLog } from "@/lib/call-log-form";
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
  deleteCallLog.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

async function clickDelete() {
  const user = setupUser();
  await user.click(screen.getByRole("button", { name: "Call log actions" }));
  await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
}

describe("ManualCallActions delete", () => {
  test("a thrown action alerts instead of escaping", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    vi.stubGlobal("confirm", vi.fn(() => true));
    deleteCallLog.mockImplementation(async () => {
      throw new Error("db down");
    });
    render(<ManualCallActions item={item} canEdit canDelete />);
    await clickDelete();

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0]![0]).toMatch(/try again/i);
  });

  test("a refusal returned by the action is surfaced verbatim", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    vi.stubGlobal("confirm", vi.fn(() => true));
    deleteCallLog.mockResolvedValue({ ok: false, error: "Provider item" });
    render(<ManualCallActions item={item} canEdit canDelete />);

    await clickDelete();

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Provider item"));
  });

  test("declining the confirm never calls the action", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<ManualCallActions item={item} canEdit canDelete />);

    await clickDelete();

    expect(deleteCallLog).not.toHaveBeenCalled();
  });

  test("renders nothing without edit or delete permission", () => {
    const { container } = render(
      <ManualCallActions item={item} canEdit={false} canDelete={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
