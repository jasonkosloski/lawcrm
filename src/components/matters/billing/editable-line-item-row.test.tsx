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
    date: new Date(2026, 3, 15),
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
