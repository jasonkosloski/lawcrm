/**
 * Tests for ExpenseComposer.
 *
 * The composer's behavior worth pinning down:
 *   - Collapsed by default; expand on "Log expense" click.
 *   - Receipt picker searches the matter's documents and posts the
 *     pick as receiptDocumentId.
 *   - Server validation errors surface inline on the right field.
 *   - On success (state.status==="ok"), the form resets + collapses.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserTimeZoneProvider } from "@/components/user-time-zone";

vi.mock("@/app/actions/expenses", () => ({
  createExpense: vi.fn(),
  searchReceiptDocuments: vi.fn(),
}));

import { createExpense, searchReceiptDocuments } from "@/app/actions/expenses";
import { ExpenseComposer } from "./expense-composer";

const mockedAction = vi.mocked(createExpense);
const mockedSearch = vi.mocked(searchReceiptDocuments);

beforeEach(() => {
  mockedAction.mockReset();
  // Default success that fires whatever the form posts back.
  mockedAction.mockImplementation(async () => ({ status: "ok" as const }));
  mockedSearch.mockReset();
  mockedSearch.mockImplementation(async (_matterId, query) =>
    [
      { id: "doc1", name: "Filing fee receipt.pdf" },
      { id: "doc2", name: "Court costs.pdf" },
    ].filter((d) => d.name.toLowerCase().includes(query.toLowerCase())),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ExpenseComposer — collapsed mode", () => {
  test("renders just the 'Log expense' button initially", () => {
    const { container } = render(<ExpenseComposer matterId="m1" />);
    expect(screen.getByRole("button", { name: /log expense/i })).toBeInTheDocument();
    // Form fields hidden until expanded.
    expect(container.querySelector('[name="amount"]')).toBeNull();
  });

  test("clicking 'Log expense' expands the form", async () => {
    const user = userEvent.setup();
    const { container } = render(<ExpenseComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    expect(container.querySelector('[name="amount"]')).toBeInTheDocument();
    expect(container.querySelector('[name="description"]')).toBeInTheDocument();
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
  test("posts no receipt by default", async () => {
    const user = userEvent.setup();
    const { container } = render(<ExpenseComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    const field = container.querySelector('[name="receiptDocumentId"]') as HTMLInputElement;
    expect(field.value).toBe("");
    expect(screen.getByLabelText(/^receipt/i)).toHaveTextContent(/no receipt/i);
  });

  test("searches the matter's documents as you type and posts the pick", async () => {
    const user = userEvent.setup();
    const { container } = render(<ExpenseComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    await user.click(screen.getByLabelText(/^receipt/i));
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledWith("m1", ""));

    await user.type(screen.getByLabelText(/search documents/i), "court");
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledWith("m1", "court"));
    await user.click(await screen.findByRole("button", { name: /court costs/i }));

    expect((container.querySelector('[name="receiptDocumentId"]') as HTMLInputElement).value).toBe(
      "doc2",
    );
    expect(screen.getByLabelText(/^receipt/i)).toHaveTextContent("Court costs.pdf");

    // Remove clears it again.
    await user.click(screen.getByRole("button", { name: /remove receipt/i }));
    expect((container.querySelector('[name="receiptDocumentId"]') as HTMLInputElement).value).toBe(
      "",
    );
  });

  test("an empty matter explains where receipts come from", async () => {
    mockedSearch.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ExpenseComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    await user.click(screen.getByLabelText(/^receipt/i));
    expect(await screen.findByText(/no documents on this matter yet/i)).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: /^log expense$/i }));

    expect(await screen.findByText(/Amount must be greater than 0/)).toBeInTheDocument();
  });

  test("top-level error message renders when state.error is set", async () => {
    mockedAction.mockResolvedValueOnce({
      status: "error",
      error: "Matter not found.",
    });
    const user = userEvent.setup();
    const { container } = render(<ExpenseComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    await user.type(container.querySelector('[name="description"]')!, "Filing fee");
    await user.type(container.querySelector('[name="amount"]')!, "100");
    await user.click(screen.getByRole("button", { name: /^log expense$/i }));

    expect(await screen.findByText("Matter not found.")).toBeInTheDocument();
  });
});

describe("ExpenseComposer — labels (F889)", () => {
  test("every field is reachable by its label", async () => {
    const user = userEvent.setup();
    render(<ExpenseComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    for (const label of [
      /^date/i,
      /^amount/i,
      /^category/i,
      /^description/i,
      /^utbms code/i,
      /^notes/i,
      /^receipt/i,
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});

describe("ExpenseComposer — default date is today in the profile zone (ADR-012)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("at 8 PM Apr 27 in Denver (02:00Z Apr 28) the date defaults to Apr 27", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-28T02:00:00Z"));
    const user = userEvent.setup();
    render(
      <UserTimeZoneProvider timeZone="America/Denver">
        <ExpenseComposer matterId="m1" />
      </UserTimeZoneProvider>,
    );
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    expect((screen.getByLabelText(/^date/i) as HTMLInputElement).value).toBe("2026-04-27");
  });

  test("the same instant is Apr 28 for a UTC profile", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-28T02:00:00Z"));
    const user = userEvent.setup();
    render(
      <UserTimeZoneProvider timeZone="UTC">
        <ExpenseComposer matterId="m1" />
      </UserTimeZoneProvider>,
    );
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    expect((screen.getByLabelText(/^date/i) as HTMLInputElement).value).toBe("2026-04-28");
  });
});

describe("ExpenseComposer — success path", () => {
  test("a second successful submit also collapses and resets (state-object identity)", async () => {
    const user = userEvent.setup();
    const { container } = render(<ExpenseComposer matterId="m1" />);
    for (const desc of ["First", "Second"]) {
      await user.click(screen.getByRole("button", { name: /log expense/i }));
      await user.type(container.querySelector('[name="description"]')!, desc);
      await user.type(container.querySelector('[name="amount"]')!, "10");
      await user.click(screen.getByRole("button", { name: /^log expense$/i }));
      await waitFor(() => expect(container.querySelector('[name="amount"]')).toBeNull());
    }
    expect(mockedAction).toHaveBeenCalledTimes(2);
  });

  test("on status:ok, the form collapses + resets", async () => {
    mockedAction.mockResolvedValueOnce({ status: "ok" });
    const user = userEvent.setup();
    const { container } = render(<ExpenseComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    await user.type(container.querySelector('[name="description"]')!, "Filing fee");
    await user.type(container.querySelector('[name="amount"]')!, "350.00");
    await user.click(screen.getByRole("button", { name: /^log expense$/i }));

    // After the success effect fires, the composer collapses back
    // to the button form. Wait on the FIELD disappearing — the
    // collapsed trigger and the expanded submit button share the
    // accessible name "Log expense", so findByRole(button) resolves
    // on the still-mounted submit button and races the effect
    // (observed flaky under pre-commit load).
    await waitFor(() => expect(container.querySelector('[name="amount"]')).toBeNull());

    // Reset: reopening shows an empty form, not the last entry.
    await user.click(screen.getByRole("button", { name: /log expense/i }));
    expect((container.querySelector('[name="description"]') as HTMLInputElement).value).toBe("");
    expect((container.querySelector('[name="amount"]') as HTMLInputElement).value).toBe("");
  });
});
