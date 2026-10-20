/**
 * PartyComposer - typeahead keyboard handling, unlink behaviour,
 * error visibility, and success collapse.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/parties", () => ({
  createMatterContact: vi.fn(),
}));

import { createMatterContact } from "@/app/actions/parties";
import { PartyComposer, type ContactOption } from "./party-composer";

const mockedAction = vi.mocked(createMatterContact);

beforeEach(() => {
  mockedAction.mockReset();
  mockedAction.mockResolvedValue({ status: "ok" });
});

const contacts: ContactOption[] = [
  {
    id: "c1",
    name: "Maria Alvarez",
    organization: "Alvarez Co",
    email: "maria@example.com",
    phone: null,
    city: "Denver",
    type: "client",
  },
  {
    id: "c2",
    name: "Marcus Webb",
    organization: null,
    email: null,
    phone: null,
    city: null,
    type: "witness",
  },
];

async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /add a lay witness/i }));
  return screen.getByRole("combobox", { name: /party name/i });
}

const render_ = () =>
  render(
    <PartyComposer matterId="m1" category="lay_witness" contacts={contacts} />
  );

describe("PartyComposer - Enter in the name typeahead", () => {
  test("Enter never submits, so a partial name can't create a junk contact", async () => {
    const user = userEvent.setup();
    render_();
    const input = await expand(user);
    await user.type(input, "Mar{Enter}");
    expect(mockedAction).not.toHaveBeenCalled();
    // Typing keeps working and the suggestion list is still there.
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  test("ArrowDown + Enter picks the highlighted contact (chip + existing mode)", async () => {
    const user = userEvent.setup();
    const { container } = render_();
    const input = await expand(user);
    await user.type(input, "Mar");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(mockedAction).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>('input[name="contactMode"]')
        ?.value
    ).toBe("__existing__");
    expect(
      container.querySelector<HTMLInputElement>('input[name="contactId"]')
        ?.value
    ).toBe("c1");
  });

  test("the input is a labelled combobox wired to its listbox", async () => {
    const user = userEvent.setup();
    render_();
    const input = await expand(user);
    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.type(input, "Mar");
    expect(input).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("listbox");
    expect(input).toHaveAttribute("aria-controls", list.id);
    await user.keyboard("{ArrowDown}");
    const active = screen.getAllByRole("option")[0];
    expect(input).toHaveAttribute("aria-activedescendant", active.id);
    expect(active).toHaveAttribute("aria-selected", "true");
  });
});

describe("PartyComposer - unlink", () => {
  test("unlinking clears the picked name (no duplicate Contact) and refocuses the input", async () => {
    const user = userEvent.setup();
    const { container } = render_();
    const input = await expand(user);
    await user.type(input, "Mar");
    await user.click(screen.getByRole("option", { name: /maria alvarez/i }));
    await user.click(
      screen.getByRole("button", { name: /unlink selected contact/i })
    );
    expect(
      container.querySelector<HTMLInputElement>('input[name="newContactName"]')
        ?.value
    ).toBe("");
    expect(screen.getByRole("combobox", { name: /party name/i })).toHaveFocus();
  });
});

describe("PartyComposer - submit", () => {
  test("posts the new-contact fields and collapses on success", async () => {
    const user = userEvent.setup();
    render_();
    const input = await expand(user);
    await user.type(input, "Zed Newperson");
    await user.type(screen.getByLabelText("Subrole"), "eyewitness");
    await user.click(screen.getByRole("button", { name: "Add party" }));

    await waitFor(() => expect(mockedAction).toHaveBeenCalledTimes(1));
    const fd = mockedAction.mock.calls[0][2] as FormData;
    expect(mockedAction.mock.calls[0][0]).toBe("m1");
    expect(fd.get("contactMode")).toBe("__new__");
    expect(fd.get("newContactName")).toBe("Zed Newperson");
    expect(fd.get("role")).toBe("eyewitness");
    expect(fd.get("category")).toBe("lay_witness");
    // Collapsed back to the add button.
    expect(
      await screen.findByRole("button", { name: /add a lay witness/i })
    ).toBeInTheDocument();
  });

  test("a rejected submit keeps the typed input and surfaces hidden-field errors", async () => {
    mockedAction.mockResolvedValue({
      status: "error",
      errors: { role: ["String must contain at most 80 character(s)"] },
    });
    const user = userEvent.setup();
    render_();
    const input = await expand(user);
    await user.type(input, "Zed Newperson");
    await user.click(screen.getByRole("button", { name: "Add party" }));

    // The role error has no inline slot: it must still be visible.
    expect(await screen.findByRole("alert")).toHaveTextContent(/at most 80/i);
    expect(screen.getByRole("combobox", { name: /party name/i })).toHaveValue(
      "Zed Newperson"
    );
  });

  test("an error on a picked contact (no typeahead on screen) is shown", async () => {
    mockedAction.mockResolvedValue({
      status: "error",
      errors: { contactId: ["That contact was merged into another."] },
    });
    const user = userEvent.setup();
    render_();
    const input = await expand(user);
    await user.type(input, "Mar");
    await user.click(screen.getByRole("option", { name: /maria alvarez/i }));
    await user.click(screen.getByRole("button", { name: "Add party" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/merged/i);
  });

  test("text inputs carry the server length limits", async () => {
    const user = userEvent.setup();
    render_();
    await expand(user);
    expect(screen.getByLabelText("Subrole")).toHaveAttribute("maxlength", "80");
    expect(screen.getByLabelText("Notes")).toHaveAttribute("maxlength", "4000");
    expect(screen.getByLabelText("Phone")).toHaveAttribute("maxlength", "80");
  });
});

describe("PartyComposer - conflict gate (ADR-054)", () => {
  test("a conflict prompt shows the matches, and the tick posts the fingerprint on resubmit", async () => {
    const user = userEvent.setup();
    mockedAction.mockResolvedValueOnce({
      status: "error",
      conflict: {
        severity: "warn",
        matches: [{ severity: "warn", description: "Acme — former client" }],
        fingerprint: "fp-party",
        canOverride: false,
      },
    });
    render(
      <PartyComposer matterId="m1" category="opposing" contacts={contacts} />
    );
    await user.click(screen.getByRole("button", { name: /opposing/i }));
    await user.type(screen.getByRole("combobox", { name: /party name/i }), "Acme");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /add party/i }));
    expect(await screen.findByText("Acme — former client")).toBeInTheDocument();

    await user.click(screen.getByLabelText(/reviewed these possible conflicts/i));
    await user.click(screen.getByRole("button", { name: /add party/i }));
    await waitFor(() => expect(mockedAction).toHaveBeenCalledTimes(2));
    const fd = mockedAction.mock.calls[1][2] as FormData;
    expect(fd.get("conflictAck")).toBe("fp-party");
  });
});
