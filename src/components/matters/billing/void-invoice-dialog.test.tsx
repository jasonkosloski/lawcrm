/**
 * Tests for VoidInvoiceDialog: copy, the client-notice option (gated on
 * canSendInvoice), required recipient while ticked, submitted fields,
 * and success / warning notifications.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/billing", () => ({
  voidInvoice: vi.fn(),
}));
vi.mock("@/lib/feedback", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
}));

import { voidInvoice } from "@/app/actions/billing";
import { notifySuccess, notifyWarning } from "@/lib/feedback";
import { VoidInvoiceDialog } from "./void-invoice-dialog";

const mockedAction = vi.mocked(voidInvoice);

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
  canSendInvoice: true,
};
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });
const voidBtn = () => screen.getByRole("button", { name: /^void invoice$/i });

describe("VoidInvoiceDialog", () => {
  test("shows the exact copy, a checked checkbox and the pre-filled recipient", () => {
    render(<VoidInvoiceDialog {...props} open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Void invoice INV-001")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Voiding returns its time and expenses to unbilled. Filed copies are stamped VOID.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Email the client a voided copy" })).toBeChecked();
    expect(screen.getByLabelText(/recipient/i)).toHaveValue("client@x.com");
  });

  test("without canSendInvoice there is no checkbox or recipient", () => {
    render(<VoidInvoiceDialog {...props} canSendInvoice={false} open onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText(/recipient/i)).toBeNull();
  });

  test("button is disabled while ticked with an empty recipient", async () => {
    const user = setupUser();
    render(<VoidInvoiceDialog {...props} clientEmail={null} open onOpenChange={vi.fn()} />);
    expect(voidBtn()).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(voidBtn()).toBeEnabled();
  });

  test("submits notifyClient and recipient, toasts success, closes", async () => {
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(<VoidInvoiceDialog {...props} open onOpenChange={onOpenChange} />);
    await user.click(voidBtn());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockedAction.mock.calls[0][0]).toBe("inv1");
    const fd = mockedAction.mock.calls[0][2] as FormData;
    expect(fd.get("notifyClient")).toBe("true");
    expect(fd.get("recipient")).toBe("client@x.com");
    expect(notifySuccess).toHaveBeenCalledWith("Invoice voided.");
    expect(notifyWarning).not.toHaveBeenCalled();
  });

  test("unticked sends no notifyClient", async () => {
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(<VoidInvoiceDialog {...props} open onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole("checkbox"));
    await user.click(voidBtn());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const fd = mockedAction.mock.calls[0][2] as FormData;
    expect(fd.get("notifyClient")).toBeFalsy();
  });

  test("a warning result toasts the warning once", async () => {
    const user = setupUser();
    mockedAction.mockImplementation(async () => ({
      status: "ok" as const,
      warning: "W",
    }));
    render(<VoidInvoiceDialog {...props} open onOpenChange={vi.fn()} />);
    await user.click(voidBtn());
    await waitFor(() => expect(notifyWarning).toHaveBeenCalledWith("W"));
    expect(notifyWarning).toHaveBeenCalledTimes(1);
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  test("an error result shows the message and stays open", async () => {
    const user = setupUser();
    const onOpenChange = vi.fn();
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      error: "Nope",
    }));
    render(<VoidInvoiceDialog {...props} open onOpenChange={onOpenChange} />);
    await user.click(voidBtn());
    expect(await screen.findByText("Nope")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
