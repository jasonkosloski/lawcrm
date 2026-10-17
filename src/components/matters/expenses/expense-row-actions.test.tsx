/**
 * Tests for ExpenseRowActions — the delete kebab on expense rows.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/expenses", () => ({
  deleteExpense: vi.fn(),
}));

import { deleteExpense } from "@/app/actions/expenses";
import { ExpenseRowActions } from "./expense-row-actions";

// happy-dom doesn't implement alert/confirm — stub them as globals
// (vi.spyOn(window, "alert") throws "can only spy on a function").
const alertMock = vi.fn();
const confirmMock = vi.fn();

beforeEach(() => {
  vi.mocked(deleteExpense).mockReset();
  vi.mocked(deleteExpense).mockResolvedValue({ ok: true });
  alertMock.mockReset();
  confirmMock.mockReset();
  vi.stubGlobal("alert", alertMock);
  vi.stubGlobal("confirm", confirmMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderRow = (over: Partial<Parameters<typeof ExpenseRowActions>[0]> = {}) =>
  render(
    <ExpenseRowActions
      expenseId="e1"
      description="Postage"
      isBilled={false}
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
    confirmMock.mockReturnValue(true);
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole("button", { name: /expense actions/i }));
    await user.click(await screen.findByText(/delete expense/i));
    await waitFor(() => expect(deleteExpense).toHaveBeenCalledWith("e1"));
  });

  test("declining the confirm does not delete", async () => {
    confirmMock.mockReturnValue(false);
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole("button", { name: /expense actions/i }));
    await user.click(await screen.findByText(/delete expense/i));
    expect(deleteExpense).not.toHaveBeenCalled();
  });

  test("a server refusal is alerted", async () => {
    confirmMock.mockReturnValue(true);
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
