/**
 * Tests for RecordPaymentDialog.
 *
 * The regression worth pinning: the close-on-success effect must
 * key on the action-state OBJECT, not the status string.
 * useActionState keeps its state across submissions, so after the
 * first success the status is "ok" forever — an effect depending
 * on `state.status` never re-fires for a second successful payment
 * (partial payment → reopen → pay the rest), leaving the dialog
 * open and inviting a duplicate submission. Each action invocation
 * returns a fresh object, so object identity is the reliable
 * "a submission just finished" signal.
 *
 * The second regression pinned here: useActionState keeps a FAILED
 * state forever too, and this component stays mounted across
 * close/reopen — so without the useDialogActionState masking, a
 * failed attempt's error banner reappears the next time the dialog
 * opens, looking like a live failure. Stale errors must be masked
 * on reopen; fresh errors and successes must still surface.
 */

import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/billing", () => ({
  recordInvoicePayment: vi.fn(),
}));

import { recordInvoicePayment } from "@/app/actions/billing";
import { RecordPaymentDialog } from "./record-payment-dialog";

const mockedAction = vi.mocked(recordInvoicePayment);

// Fresh object per call — mirrors real server actions, whose
// return value is deserialized over the wire and therefore never
// reference-equal across submissions. `mockResolvedValue` would
// hand back the SAME object each time and mask the very bug this
// suite pins (React bails out on Object.is-equal state).
beforeEach(() => {
  mockedAction.mockReset();
  mockedAction.mockImplementation(async () => ({ status: "ok" as const }));
});

const baseProps = {
  invoiceId: "inv1",
  invoiceNumber: "INV-001",
  invoiceBalance: 500,
  trustBalance: 0,
  clientEmail: null,
};

// Radix locks body pointer-events while the dialog is open;
// userEvent's computed-style check trips over that in happy-dom,
// so disable it — the elements are genuinely interactive.
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("RecordPaymentDialog — close on success", () => {
  test("closes the dialog after a successful payment", async () => {
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(
      <RecordPaymentDialog {...baseProps} open onOpenChange={onOpenChange} />
    );

    // Amount defaults to the open balance, so the form is
    // submittable as-is ("paid in full" is one click).
    await user.click(screen.getByRole("button", { name: /record \$/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockedAction).toHaveBeenCalledOnce();
    // Bound arg — the action is invoiceId-bound via .bind().
    expect(mockedAction.mock.calls[0][0]).toBe("inv1");
  });

  test("closes again on a SECOND successful payment after reopening", async () => {
    // The regression case: partial payment → dialog reopened for
    // the remainder → second submit succeeds. The component stays
    // mounted across the close/reopen (only the dialog's content
    // unmounts), so useActionState still holds {status:"ok"} from
    // round one — the effect must fire off the new state object.
    //
    // A stateful harness plays the parent (like the invoice action
    // bar): onOpenChange drives `open`, and a reopen button stands
    // in for clicking "Record payment" again.
    const onOpenChange = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            reopen dialog
          </button>
          <RecordPaymentDialog
            {...baseProps}
            open={open}
            onOpenChange={(o) => {
              onOpenChange(o);
              setOpen(o);
            }}
          />
        </>
      );
    }

    const user = setupUser();
    render(<Harness />);

    // Round one: pay → dialog closes.
    await user.click(screen.getByRole("button", { name: /record \$/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /record \$/i })
      ).not.toBeInTheDocument()
    );

    // Round two: reopen and pay again. With the effect keyed on
    // `state.status` this is where the bug bit — status was
    // already "ok", so the close effect never re-fired.
    await user.click(screen.getByRole("button", { name: /reopen dialog/i }));
    onOpenChange.mockClear();
    await user.click(
      await screen.findByRole("button", { name: /record \$/i })
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockedAction).toHaveBeenCalledTimes(2);
  });

  test("stays open and surfaces the error when the action fails", async () => {
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      error: "Invoice is not in a payable state.",
    }));
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(
      <RecordPaymentDialog {...baseProps} open onOpenChange={onOpenChange} />
    );

    await user.click(screen.getByRole("button", { name: /record \$/i }));

    expect(
      await screen.findByText("Invoice is not in a payable state.")
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("RecordPaymentDialog — stale error masking on reopen", () => {
  // Shared harness: stateful parent drives `open` (like the invoice
  // action bar does), with a reopen button standing in for clicking
  // "Record payment" again. The component stays mounted across the
  // close/reopen — only the dialog content unmounts — so
  // useActionState still holds the failed state from round one.
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          reopen dialog
        </button>
        <RecordPaymentDialog
          {...baseProps}
          open={open}
          onOpenChange={setOpen}
        />
      </>
    );
  }

  const submitButton = () =>
    screen.getByRole("button", { name: /record \$/i });

  const closeAndReopen = async (user: ReturnType<typeof setupUser>) => {
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /record \$/i })
      ).not.toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /reopen dialog/i }));
    await screen.findByRole("button", { name: /record \$/i });
  };

  test("failed attempt's banner does NOT reappear on reopen; a new failure shows the new banner", async () => {
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      error: "First failure.",
    }));
    const user = setupUser();
    render(<Harness />);

    // Round one: submit fails → banner renders.
    await user.click(submitButton());
    expect(await screen.findByText("First failure.")).toBeInTheDocument();

    // Close → reopen: the stale banner must be masked.
    await closeAndReopen(user);
    expect(screen.queryByText("First failure.")).not.toBeInTheDocument();

    // Round two: a fresh failure must still surface — masking only
    // hides state that predates this open session.
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      error: "Second failure.",
    }));
    await user.click(submitButton());
    expect(await screen.findByText("Second failure.")).toBeInTheDocument();
    expect(screen.queryByText("First failure.")).not.toBeInTheDocument();
  });

  test("success still closes the dialog after a failed-then-reopened session", async () => {
    // Pins that the masking doesn't eat the close-on-success signal:
    // error → close → reopen → successful submit must still close.
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      error: "Not payable yet.",
    }));
    const user = setupUser();
    render(<Harness />);

    await user.click(submitButton());
    expect(await screen.findByText("Not payable yet.")).toBeInTheDocument();
    await closeAndReopen(user);

    mockedAction.mockImplementation(async () => ({ status: "ok" as const }));
    await user.click(submitButton());
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /record \$/i })
      ).not.toBeInTheDocument()
    );
    expect(mockedAction).toHaveBeenCalledTimes(2);
  });
});
