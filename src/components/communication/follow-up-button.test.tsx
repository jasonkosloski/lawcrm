/**
 * Tests for FollowUpButton.
 *
 * The regression worth pinning: the popover's date input used to
 * capture `followUpAt` once at mount (`useState(toDateInput(...))`)
 * and never re-sync. After a save the server revalidates and the
 * prop updates, but reopening the popover showed the stale
 * mount-time date — and pressing Save would silently reset the
 * follow-up back to it. The input must re-sync from the prop on
 * every open.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FollowUpButton, type FollowUpAction } from "./follow-up-button";

// Base UI toggles pointer-events while the popup animates; the
// computed-style check trips over that in happy-dom even though the
// elements are genuinely interactive, so disable it.
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

const okAction = (): FollowUpAction =>
  vi.fn(async () => ({ ok: true as const }));

/** yyyy-mm-dd for a local date, matching the component's input format. */
function iso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** The trigger's accessible name changes with state ("Follow up" vs.
 *  the date chip label), but its `title` always starts "Follow up…". */
const trigger = () => screen.getByTitle(/follow.?up/i);

async function openPopover(user: ReturnType<typeof setupUser>) {
  await user.click(trigger());
  await screen.findByText(/follow up by/i);
  return document.querySelector('input[type="date"]') as HTMLInputElement;
}

describe("FollowUpButton — date input re-syncs with followUpAt on open", () => {
  test("reopening after the prop changes shows the new date, not the mount-time one", async () => {
    const user = setupUser();
    const action = okAction();
    const { rerender } = render(
      <FollowUpButton threadId="t1" followUpAt={null} action={action} />
    );

    // Open once with no follow-up — input starts empty.
    let input = await openPopover(user);
    expect(input.value).toBe("");
    await user.click(trigger()); // toggle closed

    // Server revalidation lands a new follow-up date.
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    rerender(
      <FollowUpButton threadId="t1" followUpAt={nextWeek} action={action} />
    );

    // Reopen: the input must show the fresh date, not the stale "".
    input = await openPopover(user);
    expect(input.value).toBe(iso(nextWeek));
  });

  test("preset saves the preset date, not whatever the input held", async () => {
    const user = setupUser();
    const action = okAction();
    render(<FollowUpButton threadId="t1" followUpAt={null} action={action} />);

    await openPopover(user);
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await waitFor(() =>
      expect(action).toHaveBeenCalledWith("t1", iso(tomorrow))
    );
  });

  test("after Clear revalidates to null, reopening shows an empty input", async () => {
    const user = setupUser();
    const action = okAction();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);
    const { rerender } = render(
      <FollowUpButton threadId="t1" followUpAt={dueDate} action={action} />
    );

    // Sanity: the input opens pre-filled with the current follow-up.
    const input = await openPopover(user);
    expect(input.value).toBe(iso(dueDate));

    await user.click(screen.getByRole("button", { name: /clear/i }));
    await waitFor(() => expect(action).toHaveBeenCalledWith("t1", null));

    // Server revalidation clears the prop; reopening must not
    // resurrect the old date in the input.
    rerender(
      <FollowUpButton threadId="t1" followUpAt={null} action={action} />
    );
    const reopened = await openPopover(user);
    expect(reopened.value).toBe("");
  });
});
