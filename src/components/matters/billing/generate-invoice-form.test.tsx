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

import { bundleAsInternalRecord, generateInvoiceFromWip } from "@/app/actions/billing";
import { GenerateInvoiceForm } from "./generate-invoice-form";
import { BundleInternalRecordForm } from "./bundle-internal-record-form";

const mockedGenerate = vi.mocked(generateInvoiceFromWip);
const mockedBundle = vi.mocked(bundleAsInternalRecord);

beforeEach(() => {
  mockedGenerate.mockReset();
  mockedBundle.mockReset();
});

const field = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement;

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

describe("WIP includes billable expenses the server bundles (F165)", () => {
  test("a matter with only unbilled expenses can still generate an invoice", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <GenerateInvoiceForm
        matterId="m1"
        amountTotal={0}
        entryCount={0}
        expenseTotal={402.5}
        expenseCount={1}
      />,
    );
    expect(screen.queryByText(/no unbilled/i)).not.toBeInTheDocument();
    const cta = screen.getByRole("button", { name: /generate invoice/i });
    expect(cta).toHaveTextContent("$402.50");
    expect(cta).toHaveTextContent("1 expense");
    await user.click(cta);
    expect(screen.getByText(/into a draft invoice/i)).toHaveTextContent(
      "1 expense totaling $402.50",
    );
  });

  test("time + expenses: the CTA and confirmation show the combined total and both counts", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <GenerateInvoiceForm
        matterId="m1"
        amountTotal={1000}
        entryCount={5}
        expenseTotal={0.1}
        expenseCount={2}
      />,
    );
    const cta = screen.getByRole("button", { name: /generate invoice/i });
    expect(cta).toHaveTextContent("$1,000.10");
    expect(cta).toHaveTextContent("5 entries + 2 expenses");
    await user.click(cta);
    expect(screen.getByText(/into a draft invoice/i)).toHaveTextContent(
      "5 entries + 2 expenses totaling $1,000.10",
    );
  });

  test("nothing of either kind: the empty state names both", () => {
    render(<GenerateInvoiceForm matterId="m1" amountTotal={0} entryCount={0} />);
    expect(screen.getByText(/no unbilled time or expenses/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate invoice/i })).not.toBeInTheDocument();
  });

  test("the bundle form is offered for an expenses-only matter and counts them", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <BundleInternalRecordForm
        matterId="m1"
        amountTotal={0}
        entryCount={0}
        expenseTotal={75}
        expenseCount={3}
      />,
    );
    await user.click(screen.getByRole("button", { name: /bundle as internal record/i }));
    expect(screen.getByText(/close out/i)).toHaveTextContent("3 expenses totaling $75.00");
  });

  test("the bundle form stays hidden when there is nothing to bundle", () => {
    const { container } = render(
      <BundleInternalRecordForm matterId="m1" amountTotal={0} entryCount={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("collapse on success + labels", () => {
  test("generate collapses after every successful submit, not just the first", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockedGenerate.mockImplementation(async () => ({ status: "ok" as const }));
    render(<GenerateInvoiceForm matterId="m1" amountTotal={100} entryCount={2} />);

    for (let round = 0; round < 2; round++) {
      await user.click(screen.getByRole("button", { name: /generate invoice/i }));
      await user.click(screen.getByRole("button", { name: /generate draft invoice/i }));
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: /generate draft invoice/i }),
        ).not.toBeInTheDocument(),
      );
    }
    expect(mockedGenerate).toHaveBeenCalledTimes(2);
  });

  test("the form fields are labelled", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<GenerateInvoiceForm matterId="m1" amountTotal={100} entryCount={2} />);
    await user.click(screen.getByRole("button", { name: /generate invoice/i }));
    expect(screen.getByLabelText(/due in \(days\)/i)).toHaveAttribute("name", "dueDays");
    expect(screen.getByLabelText(/notes to client/i)).toHaveAttribute("name", "notes");
  });

  test("bundle: the reason field is labelled and the form collapses on success", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockedBundle.mockImplementation(async () => ({ status: "ok" as const }));
    render(<BundleInternalRecordForm matterId="m1" amountTotal={100} entryCount={2} />);
    await user.click(screen.getByRole("button", { name: /bundle as internal record/i }));
    await user.type(screen.getByLabelText(/^reason/i), "Settled");
    await user.click(screen.getByRole("button", { name: /record without billing/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /record without billing/i }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("BundleInternalRecordForm", () => {
  test("a server error keeps the typed reason", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockedBundle.mockImplementation(async () => ({
      status: "error" as const,
      error: "Nothing unbilled to bundle.",
    }));
    render(<BundleInternalRecordForm matterId="m1" amountTotal={100} entryCount={2} />);
    await user.click(screen.getByRole("button", { name: /bundle as internal record/i }));
    await user.type(field("notes"), "Settled; fees collected separately");
    await user.click(screen.getByRole("button", { name: /record without billing/i }));

    expect(await screen.findByText(/Nothing unbilled/i)).toBeInTheDocument();
    await waitFor(() => expect(field("notes").value).toBe("Settled; fees collected separately"));
  });
});
