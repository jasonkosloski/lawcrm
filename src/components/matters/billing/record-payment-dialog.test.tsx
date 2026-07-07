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
