/**
 * Tests for EditableLineItemRow.
 *
 * The behavior worth pinning: commitField trims outer whitespace
 * from the raw input before doing anything with it. Two things
 * ride on that trim:
 *   1. The no-op check — committing "Research " over a committed
 *      "Research" must NOT fire a server round-trip.
 *   2. The payload — the narrative is client-facing invoice text
 *      the server schema does not trim, so outer whitespace must
 *      be stripped here (internal whitespace survives).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/billing", () => ({
  updateInvoiceLineItem: vi.fn(),
}));

import { updateInvoiceLineItem } from "@/app/actions/billing";
import { EditableLineItemRow } from "./editable-line-item-row";

const mockedAction = vi.mocked(updateInvoiceLineItem);

beforeEach(() => {
  mockedAction.mockReset();
  // Fresh object per call — mirrors real server actions, whose
  // return value is deserialized and never reference-equal.
  mockedAction.mockImplementation(async () => ({ status: "ok" as const }));
});

const baseProps = {
  timeEntryId: "te1",
  initial: {
    // Stored form of a date-only value (ADR-012): UTC midnight.
    // Browser-local getters read this as Apr 14 anywhere west of UTC
    // (the firm is in Denver), which is what the old code did.
    date: new Date("2026-04-15T00:00:00Z"),
    activity: "Research",
    narrative: "Reviewed discovery responses",
    hours: 1.5,
    rate: 300,
  },
  userName: "Jason Kosloski",
  userJobTitle: "Managing Partner",
};

// The component renders a <tr>; give it a valid table home so
// happy-dom doesn't restructure the DOM out from under the queries.
const renderRow = () =>
  render(
    <table>
      <tbody>
        <EditableLineItemRow {...baseProps} />
      </tbody>
    </table>
  );

describe("EditableLineItemRow — commit trims outer whitespace", () => {
  test("value that only differs by outer whitespace is a no-op (no server call)", async () => {
    const user = userEvent.setup();
    renderRow();

    // Enter edit mode on the activity cell. The input auto-selects
    // on mount, so typing replaces the whole value.
    await user.click(screen.getByRole("button", { name: "Research" }));
    await user.keyboard("  Research  {Enter}");

    expect(mockedAction).not.toHaveBeenCalled();
    // Back in view mode with the unchanged committed value.
    expect(
      screen.getByRole("button", { name: "Research" })
    ).toBeInTheDocument();
  });

  test("real change is sent trimmed; internal whitespace survives", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(
      screen.getByRole("button", { name: "Reviewed discovery responses" })
    );
    // Outer padding + a deliberate double space inside. Enter
    // (without Shift) commits the narrative textarea.
    await user.keyboard("  Drafted  motion in limine  {Enter}");

    expect(mockedAction).toHaveBeenCalledOnce();
    // Args: (timeEntryId, initialState, formData).
    expect(mockedAction.mock.calls[0][0]).toBe("te1");
    const fd = mockedAction.mock.calls[0][2] as FormData;
    expect(fd.get("narrative")).toBe("Drafted  motion in limine");
    // The rest of the row rides along untouched.
    expect(fd.get("activity")).toBe("Research");
    expect(fd.get("hours")).toBe("1.5");
    expect(fd.get("rate")).toBe("300");

    // Optimistic view mode shows the trimmed value.
    expect(
      screen.getByRole("button", { name: "Drafted motion in limine" })
    ).toBeInTheDocument();
  });
});

describe("EditableLineItemRow — date-only values stay on the stored calendar day (ADR-012)", () => {
  test("view mode shows the stored day, not the previous local day", () => {
    renderRow();
    expect(screen.getByRole("button", { name: "Apr 15" })).toBeInTheDocument();
    expect(screen.queryByText("Apr 14")).not.toBeInTheDocument();
  });

  test("a narrative-only edit posts the unchanged stored date, never a drifted one", async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(
      screen.getByRole("button", { name: "Reviewed discovery responses" })
    );
    await user.keyboard("Fixed a typo{Enter}");

    expect(mockedAction).toHaveBeenCalledOnce();
    const fd = mockedAction.mock.calls[0][2] as FormData;
    expect(fd.get("date")).toBe("2026-04-15");
    expect(fd.get("narrative")).toBe("Fixed a typo");
    // View mode still reads Apr 15 after the optimistic update.
    expect(screen.getByRole("button", { name: "Apr 15" })).toBeInTheDocument();
  });

  test("the date editor is seeded with the stored day", async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole("button", { name: "Apr 15" }));
    const input = document.querySelector(
      'input[type="date"]'
    ) as HTMLInputElement;
    expect(input.value).toBe("2026-04-15");
  });

  test("re-syncs from a new server value (no stale row after revalidate)", () => {
    const { rerender } = render(
      <table>
        <tbody>
          <EditableLineItemRow {...baseProps} />
        </tbody>
      </table>
    );
    rerender(
      <table>
        <tbody>
          <EditableLineItemRow
            {...baseProps}
            initial={{
              ...baseProps.initial,
              date: new Date("2026-05-02T00:00:00Z"),
              activity: "Drafting",
            }}
          />
        </tbody>
      </table>
    );
    expect(screen.getByRole("button", { name: "May 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drafting" })).toBeInTheDocument();
  });
});
