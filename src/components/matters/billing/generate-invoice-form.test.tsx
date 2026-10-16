/**
 * Tests for GenerateInvoiceForm + BundleInternalRecordForm.
 *
 * - F161/F166: the invoice note prints on the client-facing invoice,
 *   so the field must say so (it used to read "Internal note").
 * - F469: a rejected submit must not wipe what the user typed
 *   (React 19 resets `<form action>` fields after every action).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/billing", () => ({
  generateInvoiceFromWip: vi.fn(),
  bundleAsInternalRecord: vi.fn(),
}));

import {
  bundleAsInternalRecord,
  generateInvoiceFromWip,
} from "@/app/actions/billing";
import { GenerateInvoiceForm } from "./generate-invoice-form";
import { BundleInternalRecordForm } from "./bundle-internal-record-form";

const mockedGenerate = vi.mocked(generateInvoiceFromWip);
const mockedBundle = vi.mocked(bundleAsInternalRecord);

beforeEach(() => {
  mockedGenerate.mockReset();
  mockedBundle.mockReset();
});

const field = (name: string) =>
  document.querySelector(`[name="${name}"]`) as HTMLInputElement;

describe("GenerateInvoiceForm", () => {
  test("labels the note as client-facing, not internal", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<GenerateInvoiceForm matterId="m1" amountTotal={100} entryCount={2} />);
    await user.click(screen.getByRole("button", { name: /generate invoice/i }));
    expect(screen.getByText(/printed on invoice/i)).toBeInTheDocument();
    expect(field("notes").placeholder).toMatch(/printed on the invoice/i);
    expect(field("notes").placeholder).not.toMatch(/internal/i);
  });

  test("a server error keeps the custom due-days and note", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockedGenerate.mockImplementation(async () => ({
      status: "error" as const,
      error: "Nothing unbilled to invoice.",
    }));
    render(<GenerateInvoiceForm matterId="m1" amountTotal={100} entryCount={2} />);
    await user.click(screen.getByRole("button", { name: /generate invoice/i }));
    await user.clear(field("dueDays"));
    await user.type(field("dueDays"), "45");
    await user.type(field("notes"), "Thank you for your business");
    await user.click(screen.getByRole("button", { name: /generate draft invoice/i }));

    expect(await screen.findByText(/Nothing unbilled/i)).toBeInTheDocument();
    expect(field("dueDays").value).toBe("45");
    expect(field("notes").value).toBe("Thank you for your business");
    const fd = mockedGenerate.mock.calls[0]![2] as FormData;
    expect(fd.get("dueDays")).toBe("45");
    expect(fd.get("notes")).toBe("Thank you for your business");
  });
});

describe("BundleInternalRecordForm", () => {
  test("a server error keeps the typed reason", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockedBundle.mockImplementation(async () => ({
      status: "error" as const,
      error: "Nothing unbilled to bundle.",
    }));
    render(
      <BundleInternalRecordForm matterId="m1" amountTotal={100} entryCount={2} />
    );
    await user.click(screen.getByRole("button", { name: /bundle as internal record/i }));
    await user.type(field("notes"), "Settled; fees collected separately");
    await user.click(screen.getByRole("button", { name: /record without billing/i }));

    expect(await screen.findByText(/Nothing unbilled/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(field("notes").value).toBe("Settled; fees collected separately")
    );
  });
});
