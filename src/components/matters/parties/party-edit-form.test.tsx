/**
 * Tests for PartyEditForm — representation picker undo semantics.
 *
 * The behavior worth pinning down: a party can carry legacy
 * free-text representation info (no representationContactId). If
 * the user accidentally picks a contact in the typeahead and then
 * clicks X to undo, the form must return to create-new mode with
 * the ORIGINAL rep fields intact — not empty strings that would
 * silently overwrite the saved data on submit.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/parties", () => ({
  updateMatterContact: vi.fn(),
}));

import { updateMatterContact } from "@/app/actions/parties";
import { PartyEditForm } from "./party-edit-form";
import type { PartyRow } from "@/lib/queries/matter-detail";
import type { ContactOption } from "./party-composer";

const mockedAction = vi.mocked(updateMatterContact);

beforeEach(() => {
  mockedAction.mockReset();
  mockedAction.mockResolvedValue({ status: "ok" });
});

/** Non-client party with legacy free-text rep info (no rep FK). */
const legacyRepParty: PartyRow = {
  id: "mc1",
  contactId: "c1",
  name: "Dana Defendant",
  organization: null,
  email: null,
  phone: null,
  phones: [],
  contactType: "opposing_party",
  isPrimaryClient: false,
  category: "opposing",
  role: "Defendant",
  notes: null,
  conflictStatus: "none",
  isRepresented: true,
  representationContactId: null,
  representationName: "Original Atty",
  representationFirm: "Legacy Firm LLP",
  representationEmail: "orig@legacyfirm.example",
  representationPhone: "(303) 555-0100",
};

const contacts: ContactOption[] = [
  {
    id: "atty1",
    name: "Sonia Steele",
    organization: "Steele & Marsh",
    email: "sonia@steelemarsh.example",
    phone: "(720) 555-0199",
    city: null,
    type: "opposing_counsel",
  },
];

const hiddenValue = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

describe("PartyEditForm — representation picker undo", () => {
  test("hydrates create-new mode from the legacy free-text fields", () => {
    const { container } = render(
      <PartyEditForm
        party={legacyRepParty}
        category="opposing"
        contacts={contacts}
        onDone={() => {}}
      />
    );
    expect(hiddenValue(container, "representationContactMode")).toBe(
      "__new__"
    );
    expect(hiddenValue(container, "newRepresentationName")).toBe(
      "Original Atty"
    );
    expect(hiddenValue(container, "newRepresentationFirm")).toBe(
      "Legacy Firm LLP"
    );
  });

  test("picking a contact switches to existing mode with that contact's details", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PartyEditForm
        party={legacyRepParty}
        category="opposing"
        contacts={contacts}
        onDone={() => {}}
      />
    );
    const repInput = screen.getByPlaceholderText(/attorney name/i);
    await user.clear(repInput);
    await user.type(repInput, "Steele");
    await user.click(screen.getByRole("button", { name: /sonia steele/i }));

    expect(hiddenValue(container, "representationContactMode")).toBe(
      "__existing__"
    );
    expect(hiddenValue(container, "representationContactId")).toBe("atty1");
    // Create-new hidden fields are gone while a contact is linked.
    expect(hiddenValue(container, "newRepresentationName")).toBeUndefined();
  });

  test("clearing an accidental pick restores the original rep fields, not blanks", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PartyEditForm
        party={legacyRepParty}
        category="opposing"
        contacts={contacts}
        onDone={() => {}}
      />
    );
    const repInput = screen.getByPlaceholderText(/attorney name/i);
    await user.clear(repInput);
    await user.type(repInput, "Steele");
    await user.click(screen.getByRole("button", { name: /sonia steele/i }));
    await user.click(
      screen.getByRole("button", { name: /unlink representing contact/i })
    );

    // Back to create-new mode with the party's saved values — a
    // save now must round-trip the legacy data unchanged.
    expect(hiddenValue(container, "representationContactMode")).toBe(
      "__new__"
    );
    expect(hiddenValue(container, "newRepresentationName")).toBe(
      "Original Atty"
    );
    expect(hiddenValue(container, "newRepresentationFirm")).toBe(
      "Legacy Firm LLP"
    );
    expect(hiddenValue(container, "newRepresentationEmail")).toBe(
      "orig@legacyfirm.example"
    );
    expect(hiddenValue(container, "newRepresentationPhone")).toBe(
      "(303) 555-0100"
    );
    // The visible typeahead shows the original name again too.
    expect(screen.getByPlaceholderText(/attorney name/i)).toHaveValue(
      "Original Atty"
    );
  });
});
