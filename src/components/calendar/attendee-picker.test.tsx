/**
 * AttendeePicker — stale-search guard, Enter in the email field, and
 * the combobox ARIA wiring.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AttendeeSearchResult } from "@/lib/queries/attendee-search";

const { searchAttendeesAction } = vi.hoisted(() => ({
  searchAttendeesAction: vi.fn(),
}));
vi.mock("@/app/actions/attendee-search", () => ({ searchAttendeesAction }));
vi.mock("@/components/ui/email-link", () => ({
  EmailLink: ({ email }: { email: string }) => <span>{email}</span>,
}));

import { AttendeePicker, type EditableAttendee } from "./attendee-picker";

const jane: AttendeeSearchResult = {
  kind: "user",
  id: "u_jane",
  name: "Jane Doe",
  email: "jane@firm.test",
  initials: "JD",
  jobTitle: "Associate",
};
const smithers: AttendeeSearchResult = {
  kind: "contact",
  id: "c_smithers",
  name: "John Smithers",
  email: "smithers@example.com",
  type: "witness",
  organization: null,
} as AttendeeSearchResult;

const nameBox = () => screen.getByLabelText("Search attendees");
const emailBox = () => screen.getByLabelText("Attendee email");

/** Type into the name box and let the 250 ms debounce fire. */
async function typeName(text: string) {
  fireEvent.change(nameBox(), { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(260);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  searchAttendeesAction.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AttendeePicker — search races", () => {
  test("a slow response for an old query doesn't overwrite the new query's results", async () => {
    let resolveOld!: (r: AttendeeSearchResult[]) => void;
    searchAttendeesAction
      .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockImplementationOnce(async () => [smithers]);
    render(<AttendeePicker value={[]} onCommit={vi.fn()} />);

    await typeName("Ja"); // slow, still in flight
    await typeName("John"); // answered immediately
    expect(screen.getByText("John Smithers")).toBeTruthy();

    // The stale "Ja" response lands late.
    await act(async () => resolveOld([jane]));

    expect(screen.queryByText("Jane Doe")).toBeNull();
    expect(screen.getByText("John Smithers")).toBeTruthy();
  });

  test("a response in flight when a pick clears the box doesn't reopen suggestions", async () => {
    let resolveSlow!: (r: AttendeeSearchResult[]) => void;
    searchAttendeesAction
      .mockImplementationOnce(() => new Promise((r) => (resolveSlow = r)))
      .mockImplementationOnce(async () => [jane]);
    const onCommit = vi.fn();
    render(<AttendeePicker value={[]} onCommit={onCommit} />);

    // A slow search is still in flight when the next query is answered
    // and Jane is picked.
    await typeName("Jan");
    await typeName("Jane");
    fireEvent.click(screen.getByText("Jane Doe"));
    expect(onCommit).toHaveBeenCalledTimes(1);

    await act(async () => resolveSlow([jane]));

    // Box was cleared by the pick: nothing is offered again.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((nameBox() as HTMLInputElement).value).toBe("");
  });
});

describe("AttendeePicker — suggestions follow the current query", () => {
  test("clearing the box and typing a new query never shows the old query's rows", async () => {
    let resolveB!: (r: AttendeeSearchResult[]) => void;
    searchAttendeesAction
      .mockImplementationOnce(async () => [jane])
      .mockImplementationOnce(() => new Promise((r) => (resolveB = r)));
    const onCommit = vi.fn();
    render(<AttendeePicker value={[]} onCommit={onCommit} />);

    await typeName("a");
    expect(screen.getByText("Jane Doe")).toBeTruthy();

    // Delete the text, then start a new query whose answer is pending.
    fireEvent.change(nameBox(), { target: { value: "" } });
    await typeName("b");

    // The "a" rows must not be offered (or Enter-pickable) for "b".
    expect(screen.queryByText("Jane Doe")).toBeNull();
    fireEvent.keyDown(nameBox(), { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();

    await act(async () => resolveB([smithers]));
    expect(screen.getByText("John Smithers")).toBeTruthy();
  });
});

describe("AttendeePicker — Enter key", () => {
  test("Enter in the name box picks the highlighted suggestion", async () => {
    searchAttendeesAction.mockResolvedValue([jane]);
    const onCommit = vi.fn();
    render(<AttendeePicker value={[]} onCommit={onCommit} />);

    await typeName("Jane");
    fireEvent.keyDown(nameBox(), { key: "Enter" });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const added = (onCommit.mock.calls[0]![0] as EditableAttendee[])[0]!;
    expect(added).toMatchObject({ kind: "user", userId: "u_jane" });
  });

  test("Enter in the email box adds the TYPED contact, not the highlighted match", async () => {
    searchAttendeesAction.mockResolvedValue([smithers]);
    const onCommit = vi.fn();
    render(<AttendeePicker value={[]} onCommit={onCommit} />);

    await typeName("John Smith"); // dropdown shows "John Smithers"
    fireEvent.change(emailBox(), { target: { value: "js@example.com" } });
    fireEvent.keyDown(emailBox(), { key: "Enter" });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const added = (onCommit.mock.calls[0]![0] as EditableAttendee[])[0]!;
    expect(added).toMatchObject({
      kind: "new",
      name: "John Smith",
      email: "js@example.com",
    });
  });

  test("Enter in the email box with no valid address adds nobody", async () => {
    searchAttendeesAction.mockResolvedValue([smithers]);
    const onCommit = vi.fn();
    render(<AttendeePicker value={[]} onCommit={onCommit} />);

    await typeName("John Smith");
    fireEvent.keyDown(emailBox(), { key: "Enter" });

    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("AttendeePicker — combobox semantics", () => {
  test("the search input is a combobox wired to its listbox and active option", async () => {
    searchAttendeesAction.mockResolvedValue([jane, smithers]);
    render(<AttendeePicker value={[]} onCommit={vi.fn()} />);

    const input = nameBox();
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");

    await typeName("J");
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);

    const options = screen.getAllByRole("option");
    expect(options[0]!.id).toBeTruthy();
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
  });
});
