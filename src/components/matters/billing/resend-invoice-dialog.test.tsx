/**
 * Tests for ResendInvoiceDialog: pre-fills the client email, posts the
 * `recipient` field, shows a server error, notifies on success/warning.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/billing", () => ({
  resendInvoiceEmail: vi.fn(),
}));
vi.mock("@/lib/feedback", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
}));

import { resendInvoiceEmail } from "@/app/actions/billing";
import { notifySuccess, notifyWarning } from "@/lib/feedback";
import { ResendInvoiceDialog } from "./resend-invoice-dialog";

const mockedAction = vi.mocked(resendInvoiceEmail);

beforeEach(() => {
  mockedAction.mockReset();
  vi.mocked(notifySuccess).mockReset();
  vi.mocked(notifyWarning).mockReset();
  mockedAction.mockImplementation(async () => ({ status: "ok" as const }));
});

const props = {
  invoiceId: "inv1",
  invoiceNumber: "INV-001",
  clientEmail: "client@x.com",
};
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("ResendInvoiceDialog", () => {
  test("shows the copy and pre-fills the recipient", () => {
    render(<ResendInvoiceDialog {...props} open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Re-send invoice INV-001")).toBeInTheDocument();
    expect(
      screen.getByText("Emails the current invoice as a PDF. Nothing else changes.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/recipient/i)).toHaveValue("client@x.com");
  });

  test("submits the recipient, toasts success, and closes", async () => {
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(<ResendInvoiceDialog {...props} open onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockedAction.mock.calls[0][0]).toBe("inv1");
    const fd = mockedAction.mock.calls[0][2] as FormData;
    expect(fd.get("recipient")).toBe("client@x.com");
    expect(notifySuccess).toHaveBeenCalledWith("Invoice emailed.");
  });

  test("a warning result toasts the warning", async () => {
    const user = setupUser();
    mockedAction.mockImplementation(async () => ({
      status: "ok" as const,
      warning: "W",
    }));
    render(<ResendInvoiceDialog {...props} open onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(notifyWarning).toHaveBeenCalledWith("W"));
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  test("shows an error banner and stays open", async () => {
    const user = setupUser();
    const onOpenChange = vi.fn();
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      error: "Boom",
    }));
    render(<ResendInvoiceDialog {...props} open onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    expect(await screen.findByText("Boom")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
