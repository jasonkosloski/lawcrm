/**
 * PartyEditForm - submit behaviour: what gets posted (the loaded
 * `orig*` values and phone list the server diffs against), that a
 * rejected submit keeps what the user typed and shows the message, and
 * that the representation typeahead never submits the form on Enter.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const party: PartyRow = {
  id: "mc1",
  contactId: "c1",
  name: "Dana Defendant",
  organization: "Acme",
  email: "dana@example.com",
  phone: "(303) 555-0100",
  phones: [
    { id: "p1", label: "Mobile", number: "(303) 555-0100", isPrimary: true },
    { id: "p2", label: "Office", number: "(303) 555-0101", isPrimary: false },
  ],
  contactType: "other",
  isPrimaryClient: false,
  category: "opposing",
  role: "Defendant",
  notes: null,
  conflictStatus: "none",
  isRepresented: null,
  representationContactId: null,
  representationName: null,
  representationFirm: null,
  representationEmail: null,
  representationPhone: null,
};

const contacts: ContactOption[] = [
  {
    id: "atty1",
    name: "Sonia Steele",
    organization: "Steele & Marsh",
    email: "sonia@steelemarsh.example",
    phone: null,
    city: null,
    type: "opposing_counsel",
  },
  {
    id: "atty2",
    name: "Soren Stone",
    organization: null,
    email: null,
    phone: null,
    city: null,
    type: "opposing_counsel",
  },
];

function lastPosted(): FormData {
  const call = mockedAction.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call![2] as FormData;
}

describe("PartyEditForm - submit payload", () => {
  test("posts the loaded contact values and phone list for the server diff", async () => {
    const user = userEvent.setup();
    render(
      <PartyEditForm
        party={party}
        category="opposing"
        contacts={contacts}
        onDone={() => {}}
      />
    );
    await user.type(screen.getByLabelText("Notes"), "hello");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockedAction).toHaveBeenCalledTimes(1));
    const fd = lastPosted();
    expect(fd.get("origContactName")).toBe("Dana Defendant");
    expect(fd.get("origContactEmail")).toBe("dana@example.com");
    expect(fd.get("origContactOrganization")).toBe("Acme");
    const orig = JSON.parse(String(fd.get("origPhones")));
    expect(orig).toEqual(JSON.parse(String(fd.get("phones"))));
    expect(orig).toHaveLength(2);
    expect(fd.get("notes")).toBe("hello");
  });

  test("orig* fields stay at the first-render values when the party prop is refreshed mid-edit", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PartyEditForm
        party={party}
        category="opposing"
        contacts={contacts}
        onDone={() => {}}
      />
    );
    // A revalidation delivers someone else's concurrent edit.
    rerender(
      <PartyEditForm
        party={{
          ...party,
          name: "Dana Renamed",
          email: "new@example.com",
          organization: "NewCo",
        }}
        category="opposing"
        contacts={contacts}
        onDone={() => {}}
      />
    );
    await user.type(screen.getByLabelText("Notes"), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockedAction).toHaveBeenCalledTimes(1));
    const fd = lastPosted();
    expect(fd.get("origContactName")).toBe("Dana Defendant");
    expect(fd.get("origContactEmail")).toBe("dana@example.com");
    expect(fd.get("origContactOrganization")).toBe("Acme");
  });

  test("editing a phone changes `phones` but not the loaded `origPhones`", async () => {
    const user = userEvent.setup();
    render(
      <PartyEditForm
        party={party}
        category="opposing"
        contacts={contacts}
        onDone={() => {}}
      />
    );
    const numbers = screen.getAllByLabelText("Phone number");
    await user.clear(numbers[1]);
    await user.type(numbers[1], "(303) 555-9999");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockedAction).toHaveBeenCalled());
    const fd = lastPosted();
    expect(JSON.parse(String(fd.get("phones")))[1].number).toBe(
      "(303) 555-9999"
    );
    expect(JSON.parse(String(fd.get("origPhones")))[1].number).toBe(
      "(303) 555-0101"
    );
  });

  test("phone label and number inputs carry the server length limits", () => {
    render(
      <PartyEditForm
        party={party}
        category="opposing"
        contacts={contacts}
        onDone={() => {}}
      />
    );
    for (const el of screen.getAllByLabelText("Phone label")) {
      expect(el).toHaveAttribute("maxlength", "40");
    }
    for (const el of screen.getAllByLabelText("Phone number")) {
      expect(el).toHaveAttribute("maxlength", "80");
    }
  });
});

describe("PartyEditForm - result handling", () => {
  test("success calls onDone", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(
      <PartyEditForm
        party={party}
        category="opposing"
        contacts={contacts}
        onDone={onDone}
      />
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  test("a rejected submit keeps what the user typed and shows form-level errors", async () => {
    mockedAction.mockResolvedValue({
      status: "error",
      errors: { _form: ["This party was removed. Reload the page."] },
    });
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(
      <PartyEditForm
        party={party}
        category="opposing"
        contacts={contacts}
        onDone={onDone}
      />
    );
    await user.type(screen.getByLabelText("Notes"), "keep me");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /party was removed/i
    );
    // Not reset by the failed action (the React 19 form-reset trap).
    expect(screen.getByLabelText("Notes")).toHaveValue("keep me");
    expect(onDone).not.toHaveBeenCalled();
  });

  test("phone errors render next to the phone editor", async () => {
    mockedAction.mockResolvedValue({
      status: "error",
      errors: { phones: ["Phone labels are limited to 40 characters"] },
    });
    const user = userEvent.setup();
    render(
      <PartyEditForm
        party={party}
        category="opposing"
        contacts={contacts}
        onDone={() => {}}
      />
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/limited to 40/i)).toBeInTheDocument();
  });
});

describe("PartyEditForm - representation typeahead keyboard", () => {
  async function openRepInput(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Yes" }));
    return screen.getByRole("combobox", { name: /attorney name/i });
  }

  test("Enter in the attorney field does not submit and creates nothing", async () => {
    const user = userEvent.setup();
    render(
      <PartyEditForm
        party={party}
        category="opposing"
        contacts={contacts}
        onDone={() => {}}
      />
    );
    const input = await openRepInput(user);
    await user.type(input, "Son{Enter}");
    expect(mockedAction).not.toHaveBeenCalled();
  });

  test("ArrowDown + Enter picks the highlighted match; Escape closes the list", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PartyEditForm
        party={party}
        category="opposing"
        contacts={contacts}
        onDone={() => {}}
      />
    );
    const input = await openRepInput(user);
    await user.type(input, "so");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(2);

    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("option")).toBeNull();

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(mockedAction).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="representationContactId"]'
      )?.value
    ).toBe("atty2");
  });

  test("after unlinking the chip, focus lands on the attorney input", async () => {
    const user = userEvent.setup();
    render(
      <PartyEditForm
        party={{
          ...party,
          isRepresented: true,
          representationContactId: "atty1",
          representationName: "Sonia Steele",
        }}
        category="opposing"
        contacts={contacts}
        onDone={() => {}}
      />
    );
    await user.click(
      screen.getByRole("button", { name: /unlink representing contact/i })
    );
    expect(
      screen.getByRole("combobox", { name: /attorney name/i })
    ).toHaveFocus();
  });

  test("the Represented toggle exposes the pressed option", async () => {
    const user = userEvent.setup();
    render(
      <PartyEditForm
        party={party}
        category="opposing"
        contacts={contacts}
        onDone={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Unknown" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await user.click(screen.getByRole("button", { name: "Pro se" }));
    expect(screen.getByRole("button", { name: "Pro se" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Unknown" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});
