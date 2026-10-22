/**
 * Tests for ExpenseRowActions — the delete kebab on expense rows.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock("@/app/actions/expenses", () => ({
  deleteExpense: vi.fn(),
  updateExpense: vi.fn(async () => ({ status: "ok" })),
  searchReceiptDocuments: vi.fn(async () => [
    { id: "doc-new", name: "New receipt.pdf" },
  ]),
}));

import { deleteExpense, updateExpense } from "@/app/actions/expenses";
import { confirmAction, notifyError } from "@/lib/feedback";
import { ExpenseRowActions } from "./expense-row-actions";

const alertMock = vi.mocked(notifyError);
const confirmMock = vi.mocked(confirmAction);

beforeEach(() => {
  vi.mocked(deleteExpense).mockReset();
  vi.mocked(deleteExpense).mockResolvedValue({ ok: true });
  alertMock.mockReset();
  confirmMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const expenseRow = {
  id: "e1",
  date: "2026-09-30",
  amount: "12.50",
  description: "Postage",
  category: "postage" as const,
  utbmsCode: "",
  billable: true,
  clientAdvanced: false,
  notes: "",
  receiptDocumentId: "doc-old",
  receiptDocumentName: "Old receipt.pdf",
};

const renderRow = (over: Partial<Parameters<typeof ExpenseRowActions>[0]> = {}) =>
  render(
    <ExpenseRowActions
      matterId="m1"
      expense={expenseRow}
      isBilled={false}
      canEdit={false}
      canDelete
      {...over}
    />
  );

describe("ExpenseRowActions", () => {
  test("renders nothing without matters.expense.delete", () => {
    const { container } = renderRow({ canDelete: false });
    expect(container.firstChild).toBeNull();
  });

  test("renders nothing for a billed expense (the server would refuse)", () => {
    const { container } = renderRow({ isBilled: true });
    expect(container.firstChild).toBeNull();
  });

  test("confirm -> deleteExpense with the id", async () => {
    confirmMock.mockResolvedValue(true);
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole("button", { name: /expense actions/i }));
    await user.click(await screen.findByText(/delete expense/i));
    await waitFor(() => expect(deleteExpense).toHaveBeenCalledWith("e1"));
  });

  test("declining the confirm does not delete", async () => {
    confirmMock.mockResolvedValue(false);
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole("button", { name: /expense actions/i }));
    await user.click(await screen.findByText(/delete expense/i));
    expect(deleteExpense).not.toHaveBeenCalled();
  });

  test("a server refusal is toasted", async () => {
    confirmMock.mockResolvedValue(true);
    const alertSpy = alertMock;
    vi.mocked(deleteExpense).mockResolvedValueOnce({
      ok: false,
      error: "This expense has been billed on an invoice — void the invoice first.",
    });
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole("button", { name: /expense actions/i }));
    await user.click(await screen.findByText(/delete expense/i));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringMatching(/billed on an invoice/)
      )
    );
  });
});

describe("ExpenseRowActions — Edit", () => {
  test("hidden without matters.expense.edit, and on billed rows", async () => {
    const user = userEvent.setup();
    renderRow({ canEdit: false });
    await user.click(screen.getByRole("button", { name: /expense actions/i }));
    await screen.findByText(/delete expense/i);
    expect(screen.queryByText(/edit expense/i)).toBeNull();
  });

  test("edit-only viewers get a kebab; billed rows get none", () => {
    const { container, unmount } = renderRow({ canEdit: true, canDelete: false, isBilled: true });
    expect(container.firstChild).toBeNull();
    unmount();
    renderRow({ canEdit: true, canDelete: false });
    expect(screen.getByRole("button", { name: /expense actions/i })).toBeInTheDocument();
  });

  test("the dialog is seeded from the row and posts every field, keeping the attached receipt", async () => {
    const user = userEvent.setup();
    vi.mocked(updateExpense).mockClear();
    renderRow({ canEdit: true });
    await user.click(screen.getByRole("button", { name: /expense actions/i }));
    await user.click(await screen.findByText(/edit expense/i));
    expect(screen.getByLabelText(/^receipt/i)).toHaveTextContent("Old receipt.pdf");

    const amount = await screen.findByLabelText(/amount/i);
    expect(amount).toHaveValue("12.50");
    expect(screen.getByLabelText(/^date/i)).toHaveValue("2026-09-30");
    await user.clear(amount);
    await user.type(amount, "15.00");
    await user.click(screen.getByRole("button", { name: /save expense/i }));

    const [id, , fd] = vi.mocked(updateExpense).mock.calls[0];
    expect(id).toBe("e1");
    const f = fd as FormData;
    expect(f.get("amount")).toBe("15.00");
    expect(f.get("date")).toBe("2026-09-30");
    expect(f.get("description")).toBe("Postage");
    expect(f.get("category")).toBe("postage");
    expect(f.get("billable")).toBe("on");
    // The attached receipt was never searched for but must survive.
    expect(f.getAll("receiptDocumentId")).toEqual(["doc-old"]);
  });

  test("picking another document from the search swaps the receipt", async () => {
    const user = userEvent.setup();
    vi.mocked(updateExpense).mockClear();
    renderRow({ canEdit: true });
    await user.click(screen.getByRole("button", { name: /expense actions/i }));
    await user.click(await screen.findByText(/edit expense/i));
    await user.click(screen.getByLabelText(/^receipt/i));
    await user.click(await screen.findByRole("button", { name: /new receipt\.pdf/i }));
    await user.click(screen.getByRole("button", { name: /save expense/i }));

    const fd = vi.mocked(updateExpense).mock.calls[0][2] as FormData;
    expect(fd.getAll("receiptDocumentId")).toEqual(["doc-new"]);
  });
});
