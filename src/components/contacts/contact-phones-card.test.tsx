/**
 * Tests for ContactPhonesCard's manager dialog.
 *
 * The regression: the dialog is opened by an external "Manage" button
 * (setOpen(true)), and its working copy used to be seeded only in the
 * Dialog's onOpenChange — which Base UI never calls for a controlled
 * `open` change. The dialog therefore opened EMPTY, and Save (a
 * replace-all) deleted every existing number. Every open must seed
 * from the current phones.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/contacts", () => ({
  updateContactPhones: vi.fn(),
}));

import { updateContactPhones } from "@/app/actions/contacts";
import { ContactPhonesCard, seedPhoneRows } from "./contact-phones-card";

const mockedUpdate = vi.mocked(updateContactPhones);

const phones = [
  { id: "p1", label: "Cell", number: "(303) 555-0101", isPrimary: true },
  { id: "p2", label: "Office", number: "(303) 555-0102", isPrimary: false },
];

beforeEach(() => {
  mockedUpdate.mockReset();
  mockedUpdate.mockResolvedValue({ ok: true });
});

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("ContactPhonesCard manager", () => {
  test("opens seeded with the current phones; saving without edits round-trips them", async () => {
    const user = setupUser();
    render(<ContactPhonesCard contactId="c1" phones={phones} canEdit />);

    await user.click(screen.getByRole("button", { name: /manage/i }));

    const numbers = await screen.findAllByLabelText("Phone number");
    expect(numbers.map((n) => (n as HTMLInputElement).value)).toEqual([
      "(303) 555-0101",
      "(303) 555-0102",
    ]);
    expect(screen.queryByText(/no phone numbers — add one/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: /save phones/i }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    expect(mockedUpdate).toHaveBeenCalledWith("c1", [
      { label: "Cell", number: "(303) 555-0101", isPrimary: true },
      { label: "Office", number: "(303) 555-0102", isPrimary: false },
    ]);
  });

  test("cancelled edits do not leak into the next open", async () => {
    const user = setupUser();
    render(<ContactPhonesCard contactId="c1" phones={phones} canEdit />);

    await user.click(screen.getByRole("button", { name: /manage/i }));
    const first = (await screen.findAllByLabelText("Phone number"))[0];
    await user.clear(first);
    await user.type(first, "999");
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByLabelText("Phone number")).toBeNull());

    await user.click(screen.getByRole("button", { name: /manage/i }));
    const again = await screen.findAllByLabelText("Phone number");
    expect((again[0] as HTMLInputElement).value).toBe("(303) 555-0101");
  });

  test("a contact with only the legacy Contact.phone is seeded from it", async () => {
    const user = setupUser();
    render(<ContactPhonesCard contactId="c1" phones={[]} legacyPhone="(303) 555-0182" canEdit />);
    await user.click(screen.getByRole("button", { name: /manage/i }));
    const numbers = await screen.findAllByLabelText("Phone number");
    expect((numbers[0] as HTMLInputElement).value).toBe("(303) 555-0182");
  });
});

describe("ContactPhonesCard row identity", () => {
  test("Move down / Remove act on the row the user is on: rows keep their DOM node", async () => {
    const user = setupUser();
    render(<ContactPhonesCard contactId="c1" phones={phones} canEdit />);
    await user.click(screen.getByRole("button", { name: /manage/i }));

    const [rowA, rowB] = (await screen.findAllByLabelText("Phone number")) as HTMLInputElement[];
    expect([rowA.value, rowB.value]).toEqual(["(303) 555-0101", "(303) 555-0102"]);

    // Move the first row down. With index keys the two inputs would
    // just swap values in place (and keyboard focus would stay on the
    // same slot, now holding the OTHER row); with stable keys each
    // input element travels with its row.
    await user.click(screen.getAllByRole("button", { name: "Move down" })[0]);

    const after = screen.getAllByLabelText("Phone number") as HTMLInputElement[];
    expect(after[0]).toBe(rowB);
    expect(after[1]).toBe(rowA);
    expect(after.map((n) => n.value)).toEqual(["(303) 555-0102", "(303) 555-0101"]);

    // Remove the (now first) row: the survivor is the same element.
    await user.click(screen.getAllByRole("button", { name: "Remove phone" })[0]);
    const left = screen.getAllByLabelText("Phone number");
    expect(left).toHaveLength(1);
    expect(left[0]).toBe(rowA);
  });

  test("saving strips the client-only row keys", async () => {
    const user = setupUser();
    render(<ContactPhonesCard contactId="c1" phones={phones} canEdit />);
    await user.click(screen.getByRole("button", { name: /manage/i }));
    await screen.findAllByLabelText("Phone number");
    await user.click(screen.getByRole("button", { name: /add phone/i }));
    const inputs = screen.getAllByLabelText("Phone number");
    await user.type(inputs[2], "(303) 555-0103");
    await user.click(screen.getByRole("button", { name: /save phones/i }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    expect(mockedUpdate).toHaveBeenCalledWith("c1", [
      { label: "Cell", number: "(303) 555-0101", isPrimary: true },
      { label: "Office", number: "(303) 555-0102", isPrimary: false },
      { label: "", number: "(303) 555-0103", isPrimary: false },
    ]);
  });
});

describe("seedPhoneRows", () => {
  test("prefers rows, falls back to the legacy phone, else empty", () => {
    expect(seedPhoneRows(phones)).toHaveLength(2);
    expect(seedPhoneRows([], "(303) 555-0182")).toEqual([
      { label: "", number: "(303) 555-0182", isPrimary: true },
    ]);
    expect(seedPhoneRows([], null)).toEqual([]);
    expect(seedPhoneRows([], "  ")).toEqual([]);
  });
});
