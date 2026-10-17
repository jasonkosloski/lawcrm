/**
 * Tests for SendInvoiceDialog.
 *
 * Pins: the apply-trust option is gated on billing.apply_trust AND
 * available trust AND an open balance (the server refuses applyTrust
 * without the key); the trust amount is parsed like the server's
 * schema; the submit label tracks what will happen; a server error
 * keeps the typed recipient; success closes the dialog.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/billing", () => ({
  sendInvoice: vi.fn(),
}));

import { sendInvoice } from "@/app/actions/billing";
import { SendInvoiceDialog } from "./send-invoice-dialog";

const mockedAction = vi.mocked(sendInvoice);

beforeEach(() => {
  mockedAction.mockReset();
  mockedAction.mockImplementation(async () => ({ status: "ok" as const }));
});

const baseProps = {
  invoiceId: "inv1",
  invoiceNumber: "INV-001",
  invoiceBalance: 800,
  trustBalance: 500,
  clientEmail: "client@example.com",
};

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });
const trustCheckbox = () =>
  screen.queryByRole("checkbox", { name: /apply trust toward this invoice/i });

describe("SendInvoiceDialog", () => {
  test("pre-fills the recipient (labelled) and sends with the posted fields, then closes", async () => {
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(<SendInvoiceDialog {...baseProps} open onOpenChange={onOpenChange} />);

    expect(screen.getByLabelText(/email recipient/i)).toHaveValue(
      "client@example.com"
    );
    await user.click(screen.getByRole("button", { name: /^send invoice$/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockedAction.mock.calls[0][0]).toBe("inv1");
    const fd = mockedAction.mock.calls[0][2] as FormData;
    expect(fd.get("method")).toBe("email");
    expect(fd.get("recipient")).toBe("client@example.com");
    expect(fd.get("applyTrust")).toBeNull();
  });

  test("the apply-trust option needs billing.apply_trust", () => {
    const { unmount } = render(
      <SendInvoiceDialog {...baseProps} open onOpenChange={vi.fn()} />
    );
    expect(trustCheckbox()).not.toBeInTheDocument();
    unmount();

    render(
      <SendInvoiceDialog
        {...baseProps}
        canApplyTrust
        open
        onOpenChange={vi.fn()}
      />
    );
    expect(trustCheckbox()).toBeInTheDocument();
  });

  test("the apply-trust option is hidden without trust funds or without a balance", () => {
    const { unmount } = render(
      <SendInvoiceDialog
        {...baseProps}
        trustBalance={0}
        canApplyTrust
        open
        onOpenChange={vi.fn()}
      />
    );
    expect(trustCheckbox()).not.toBeInTheDocument();
    unmount();
    render(
      <SendInvoiceDialog
        {...baseProps}
        invoiceBalance={0}
        canApplyTrust
        open
        onOpenChange={vi.fn()}
      />
    );
    expect(trustCheckbox()).not.toBeInTheDocument();
  });

  test("ticking apply-trust defaults to MIN(trust, balance) and posts it", async () => {
    const user = setupUser();
    render(
      <SendInvoiceDialog
        {...baseProps}
        canApplyTrust
        open
        onOpenChange={vi.fn()}
      />
    );
    await user.click(trustCheckbox()!);
    const amount = screen.getByLabelText(/^amount/i) as HTMLInputElement;
    expect(amount.value).toBe("500.00");
    await user.click(
      screen.getByRole("button", { name: /send \+ apply trust/i })
    );
    await waitFor(() => expect(mockedAction).toHaveBeenCalledOnce());
    const fd = mockedAction.mock.calls[0][2] as FormData;
    expect(fd.get("applyTrust")).toBe("true");
    expect(fd.get("trustAmount")).toBe("500.00");
  });

  test("a comma amount is parsed like the server: caps and previews use 1,000 not 1", async () => {
    const user = setupUser();
    render(
      <SendInvoiceDialog
        {...baseProps}
        invoiceBalance={5000}
        trustBalance={4000}
        canApplyTrust
        open
        onOpenChange={vi.fn()}
      />
    );
    await user.click(trustCheckbox()!);
    const amount = screen.getByLabelText(/^amount/i);
    await user.clear(amount);
    await user.type(amount, "1,000");
    expect(screen.getByText(/balance after: \$4,000\.00/i)).toBeInTheDocument();

    await user.clear(amount);
    await user.type(amount, "4,500");
    expect(screen.getByText(/capped at \$4,000\.00/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send invoice|send \+/i })
    ).toBeDisabled();
  });

  test("unparseable trust text is called out and blocks submit", async () => {
    const user = setupUser();
    render(
      <SendInvoiceDialog
        {...baseProps}
        canApplyTrust
        open
        onOpenChange={vi.fn()}
      />
    );
    await user.click(trustCheckbox()!);
    const amount = screen.getByLabelText(/^amount/i);
    await user.clear(amount);
    await user.type(amount, "lots");
    expect(screen.getByText("Enter a valid amount.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send invoice|send \+/i })
    ).toBeDisabled();
  });

  test("trust that covers the whole balance relabels the submit", async () => {
    const user = setupUser();
    render(
      <SendInvoiceDialog
        {...baseProps}
        invoiceBalance={300}
        canApplyTrust
        open
        onOpenChange={vi.fn()}
      />
    );
    await user.click(trustCheckbox()!);
    expect(
      screen.getByRole("button", { name: /send \+ mark paid from trust/i })
    ).toBeEnabled();
  });

  test("a server error is shown and the edited recipient survives", async () => {
    const user = setupUser();
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      error: "Invoice changed.",
    }));
    render(<SendInvoiceDialog {...baseProps} open onOpenChange={vi.fn()} />);
    const recipient = screen.getByLabelText(/email recipient/i);
    await user.clear(recipient);
    await user.type(recipient, "other@example.com");
    await user.click(screen.getByRole("button", { name: /^send invoice$/i }));

    expect(await screen.findByText("Invoice changed.")).toBeInTheDocument();
    expect(screen.getByLabelText(/email recipient/i)).toHaveValue(
      "other@example.com"
    );
  });

  test("US mail is disabled", () => {
    render(<SendInvoiceDialog {...baseProps} open onOpenChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /us mail/i })).toBeDisabled();
  });
});
