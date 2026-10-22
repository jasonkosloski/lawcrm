/**
 * Tests for ApplyTrustDialog (the "earn out the retainer" flow).
 *
 * Pins the money-facing behaviour called out in F940/F467: the amount
 * defaults to MIN(trust, invoice balance), the guards use the same
 * amount parsing as the server ("$1,200" is 1200, not 1), a failed
 * submit keeps the typed amount, the source is locked to trust, and a
 * successful submit closes the dialog.
 */

import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/billing", () => ({
  recordInvoicePayment: vi.fn(),
}));

import { recordInvoicePayment } from "@/app/actions/billing";
import { ApplyTrustDialog } from "./apply-trust-dialog";
import { UserTimeZoneProvider } from "@/components/user-time-zone";

const mockedAction = vi.mocked(recordInvoicePayment);

beforeEach(() => {
  mockedAction.mockReset();
  mockedAction.mockImplementation(async () => ({ status: "ok" as const }));
});

const baseProps = {
  invoiceId: "inv1",
  invoiceNumber: "INV-001",
  invoiceBalance: 5000,
  trustBalance: 1200,
  clientEmail: null,
};

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });
const amountInput = () => screen.getByLabelText(/^amount/i) as HTMLInputElement;

describe("ApplyTrustDialog", () => {
  test("defaults the amount to MIN(trust balance, invoice balance)", () => {
    const { unmount } = render(<ApplyTrustDialog {...baseProps} open onOpenChange={vi.fn()} />);
    expect(amountInput().value).toBe("1200.00");
    unmount();

    render(<ApplyTrustDialog {...baseProps} invoiceBalance={300} open onOpenChange={vi.fn()} />);
    expect(amountInput().value).toBe("300.00");
  });

  test("posts source=trust and the amount, then closes on success", async () => {
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(<ApplyTrustDialog {...baseProps} open onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole("button", { name: /apply \$/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockedAction.mock.calls[0][0]).toBe("inv1");
    const fd = mockedAction.mock.calls[0][2] as FormData;
    expect(fd.get("source")).toBe("trust");
    expect(fd.get("amount")).toBe("1200.00");
  });

  test("cap: an amount above the trust balance is blocked, with the 'comma' form parsed correctly", async () => {
    const user = setupUser();
    render(<ApplyTrustDialog {...baseProps} open onOpenChange={vi.fn()} />);
    await user.clear(amountInput());
    await user.type(amountInput(), "1,500");
    expect(screen.getByText(/exceeds the trust balance/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply \$/i })).toBeDisabled();
  });

  test("a dollar-sign amount within the cap is accepted", async () => {
    const user = setupUser();
    render(<ApplyTrustDialog {...baseProps} open onOpenChange={vi.fn()} />);
    await user.clear(amountInput());
    await user.type(amountInput(), "$250");
    expect(screen.getByRole("button", { name: "Apply $250.00 from trust" })).toBeEnabled();
  });

  test("exceeding only the invoice balance is flagged separately", async () => {
    const user = setupUser();
    render(
      <ApplyTrustDialog
        {...baseProps}
        invoiceBalance={100}
        trustBalance={900}
        open
        onOpenChange={vi.fn()}
      />,
    );
    await user.clear(amountInput());
    await user.type(amountInput(), "150");
    expect(screen.getByText(/exceeds the invoice balance/i)).toBeInTheDocument();
  });

  test("paying the whole balance previews 'paid'", () => {
    render(
      <ApplyTrustDialog
        {...baseProps}
        invoiceBalance={400}
        trustBalance={900}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Apply $400.00 · mark paid" })).toBeEnabled();
  });

  test("unparseable text is called out and blocks submit", async () => {
    const user = setupUser();
    render(<ApplyTrustDialog {...baseProps} open onOpenChange={vi.fn()} />);
    await user.clear(amountInput());
    await user.type(amountInput(), "abc");
    expect(screen.getByText("Enter a valid amount.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply \$/i })).toBeDisabled();
  });

  test("a server error is shown and the typed amount survives", async () => {
    const user = setupUser();
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      error: "Not enough trust funds.",
    }));
    const onOpenChange = vi.fn();
    render(<ApplyTrustDialog {...baseProps} open onOpenChange={onOpenChange} />);
    await user.clear(amountInput());
    await user.type(amountInput(), "750");
    await user.click(screen.getByRole("button", { name: /apply \$/i }));

    expect(await screen.findByText("Not enough trust funds.")).toBeInTheDocument();
    expect(amountInput().value).toBe("750");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test("pending: the submit button is disabled while the action runs", async () => {
    const user = setupUser();
    let release!: () => void;
    mockedAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: "error" as const, error: "x" });
        }),
    );
    render(<ApplyTrustDialog {...baseProps} open onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /apply \$/i }));
    expect(await screen.findByRole("button", { name: /applying/i })).toBeDisabled();
    release();
    await screen.findByText("x");
  });

  test("reopening re-seeds the amount to the default", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            reopen dialog
          </button>
          <ApplyTrustDialog {...baseProps} open={open} onOpenChange={setOpen} />
        </>
      );
    }
    const user = setupUser();
    render(<Harness />);
    await user.clear(amountInput());
    await user.type(amountInput(), "5");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByLabelText(/^amount/i)).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /reopen dialog/i }));
    await screen.findByLabelText(/^amount/i);
    expect(amountInput().value).toBe("1200.00");
  });

  test("the date defaults to the viewer's today in their zone", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 02:00Z on Apr 28 = 8 PM MDT on Apr 27.
    vi.setSystemTime(new Date("2026-04-28T02:00:00Z"));
    try {
      render(
        <UserTimeZoneProvider timeZone="America/Denver">
          <ApplyTrustDialog {...baseProps} open onOpenChange={vi.fn()} />
        </UserTimeZoneProvider>,
      );
      expect(screen.getByLabelText(/^date/i)).toHaveValue("2026-04-27");
    } finally {
      vi.useRealTimers();
    }
  });
});
