/**
 * Tests for ExpenseComposer.
 *
 * The composer's behavior worth pinning down:
 *   - Collapsed by default; expand on "Log expense" click.
 *   - Receipt picker only renders when documentOptions is non-empty
 *     (no point picking from an empty list).
 *   - Server validation errors surface inline on the right field.
 *   - On success (state.status==="ok"), the form resets + collapses.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/expenses", () => ({
  createExpense: vi.fn(),
}));

import { createExpense } from "@/app/actions/expenses";
import { ExpenseComposer } from "./expense-composer";

const mockedAction = vi.mocked(createExpense);

beforeEach(() => {
  mockedAction.mockReset();
  // Default success that fires whatever the form posts back.
  mockedAction.mockResolvedValue({ status: "ok" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ExpenseComposer — collapsed mode", () => {
  test("renders just the 'Log expense' button initially", () => {
    const { container } = render(<ExpenseComposer matterId="m1" />);
    expect(
      screen.getByRole("button", { name: /log expense/i })
    ).toBeInTheDocument();
    // Form fields hidden until expanded.
    expect(container.querySelector('[name="amount"]')).toBeNull();
  });

  test("clicking 'Log expense' expands the form", async () => {
    const user = userEvent.setup();
    const { container } = render(<ExpenseComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    expect(container.querySelector('[name="amount"]')).toBeInTheDocument();
    expect(
      container.querySelector('[name="description"]')
    ).toBeInTheDocument();
    expect(container.querySelector('[name="category"]')).toBeInTheDocument();
  });

  test("Cancel button collapses back to the button mode", async () => {
    const user = userEvent.setup();
    const { container } = render(<ExpenseComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    // Two cancel surfaces (X icon + Cancel button) — both should
    // collapse. Picking the X icon (its aria-label) since
    // queryAllByRole("button", { name: /cancel/i }) returns both.
    const cancels = screen.getAllByRole("button", { name: /cancel/i });
    expect(cancels.length).toBe(2);
    await user.click(cancels[0]);
    expect(container.querySelector('[name="amount"]')).toBeNull();
  });
});

describe("ExpenseComposer — receipt picker", () => {
  test("hides the Receipt field when documentOptions is empty", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ExpenseComposer matterId="m1" documentOptions={[]} />
    );
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    expect(
      container.querySelector('[name="receiptDocumentId"]')
    ).toBeNull();
  });

  test("shows the Receipt picker when at least one document is available", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ExpenseComposer
        matterId="m1"
        documentOptions={[
          { id: "doc1", name: "Filing fee receipt.pdf" },
          { id: "doc2", name: "Court costs.pdf" },
        ]}
      />
    );
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    const picker = container.querySelector('[name="receiptDocumentId"]');
    expect(picker).toBeInTheDocument();
    // Each document surfaces as an <option>.
    expect(
      screen.getByRole("option", { name: /Filing fee receipt/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Court costs/i })
    ).toBeInTheDocument();
    // And the no-receipt sentinel.
    expect(
      screen.getByRole("option", { name: /no receipt/i })
    ).toBeInTheDocument();
  });
});

describe("ExpenseComposer — validation surface", () => {
  test("server validation errors render inline on the matching field", async () => {
    mockedAction.mockResolvedValueOnce({
      status: "error",
      errors: { amount: ["Amount must be greater than 0"] },
    });
    const user = userEvent.setup();
    const { container } = render(<ExpenseComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /log expense/i }));

    // Type something descriptive so the form has data to submit
    // (the action is mocked so its internal validation doesn't
    // run — what's tested is how the UI renders the response).
    const desc = container.querySelector('[name="description"]')!;
    await user.type(desc, "Filing fee");
    const amount = container.querySelector('[name="amount"]')!;
    await user.type(amount, "0");

    await user.click(
      screen.getByRole("button", { name: /^log expense$/i })
    );

    expect(
      await screen.findByText(/Amount must be greater than 0/)
    ).toBeInTheDocument();
  });

  test("top-level error message renders when state.error is set", async () => {
    mockedAction.mockResolvedValueOnce({
      status: "error",
      error: "Matter not found.",
    });
    const user = userEvent.setup();
    const { container } = render(<ExpenseComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    await user.type(
      container.querySelector('[name="description"]')!,
      "Filing fee"
    );
    await user.type(container.querySelector('[name="amount"]')!, "100");
    await user.click(
      screen.getByRole("button", { name: /^log expense$/i })
    );

    expect(await screen.findByText("Matter not found.")).toBeInTheDocument();
  });
});

describe("ExpenseComposer — success path", () => {
  test("on status:ok, the form collapses + resets", async () => {
    mockedAction.mockResolvedValueOnce({ status: "ok" });
    const user = userEvent.setup();
    const { container } = render(<ExpenseComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    await user.type(
      container.querySelector('[name="description"]')!,
      "Filing fee"
    );
    await user.type(container.querySelector('[name="amount"]')!, "350.00");
    await user.click(
      screen.getByRole("button", { name: /^log expense$/i })
    );

    // After the success effect fires, the composer collapses
    // back to the button form. Wait for the form fields to
    // disappear.
    await screen.findByRole("button", { name: /log expense/i });
    expect(container.querySelector('[name="amount"]')).toBeNull();
  });
});
