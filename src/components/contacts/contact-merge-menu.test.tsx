/**
 * Tests for the merge dialog.
 *
 * Pins: the picker searches on the SERVER (no client-side candidate
 * list), suggestions and the chosen chip carry type / phone / email so
 * same-named records can be told apart, the merge call carries the
 * loser (this contact) and survivor ids, an opposite-sides refusal
 * turns the button into an explicit "Merge anyway" that resubmits with
 * the confirmation, and reopening the dialog starts clean.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock("@/app/actions/contacts", () => ({
  mergeContacts: vi.fn(),
  searchMergeCandidatesAction: vi.fn(),
}));

import {
  mergeContacts,
  searchMergeCandidatesAction,
} from "@/app/actions/contacts";
import { ContactMergeMenu } from "./contact-merge-menu";

const mockedMerge = vi.mocked(mergeContacts);
const mockedSearch = vi.mocked(searchMergeCandidatesAction);

const smithClient = {
  id: "c2",
  name: "John Smith",
  type: "client",
  organization: null,
  phone: "3035550101",
  email: "john@example.com",
};
const smithDefendant = {
  id: "c3",
  name: "John Smith",
  type: "opposing_counsel",
  organization: "Smith & Co",
  phone: null,
  email: null,
};

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

async function openDialog(user: ReturnType<typeof setupUser>) {
  await user.click(
    screen.getByRole("button", { name: /more contact actions/i })
  );
  await user.click(
    await screen.findByRole("menuitem", { name: /merge into another contact/i })
  );
  return screen.findByRole("textbox", {
    name: /search contacts to merge into/i,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSearch.mockResolvedValue([smithClient, smithDefendant]);
  mockedMerge.mockResolvedValue({ ok: true });
});

describe("ContactMergeMenu", () => {
  test("searches on the server and shows type, phone and email on each suggestion", async () => {
    const user = setupUser();
    render(<ContactMergeMenu contactId="c1" contactName="J. Smith" />);

    const input = await openDialog(user);
    await user.type(input, "smith");

    await waitFor(() =>
      expect(mockedSearch).toHaveBeenLastCalledWith("c1", "smith")
    );
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    // Same name, told apart by the extra detail.
    expect(options[0]).toHaveTextContent("Client · (303) 555-0101 · john@example.com");
    expect(options[1]).toHaveTextContent("Opposing counsel");
    expect(options[1]).toHaveTextContent("Smith & Co");
  });

  test("picking a suggestion shows the detail chip; Merge sends loser then survivor and navigates", async () => {
    const user = setupUser();
    render(<ContactMergeMenu contactId="c1" contactName="J. Smith" />);

    const input = await openDialog(user);
    await user.type(input, "smith");
    await user.click((await screen.findAllByRole("option"))[0]);

    expect(
      screen.getByRole("button", { name: /clear selected contact/i })
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Client · \(303\) 555-0101/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Merge contacts" }));

    await waitFor(() => expect(mockedMerge).toHaveBeenCalledTimes(1));
    expect(mockedMerge).toHaveBeenCalledWith("c1", "c2", undefined);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/contacts/c2"));
  });

  test("an opposite-sides refusal needs an explicit Merge anyway", async () => {
    mockedMerge
      .mockResolvedValueOnce({
        ok: false,
        code: "opposite_sides",
        error: "These are on opposite sides of 1 matter.",
      })
      .mockResolvedValueOnce({ ok: true });
    const user = setupUser();
    render(<ContactMergeMenu contactId="c1" contactName="J. Smith" />);

    const input = await openDialog(user);
    await user.type(input, "smith");
    await user.click((await screen.findAllByRole("option"))[1]);
    await user.click(screen.getByRole("button", { name: "Merge contacts" }));

    expect(
      await screen.findByText("These are on opposite sides of 1 matter.")
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Merge anyway" }));

    await waitFor(() => expect(mockedMerge).toHaveBeenCalledTimes(2));
    expect(mockedMerge).toHaveBeenLastCalledWith("c1", "c3", {
      confirmOppositeSides: true,
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/contacts/c3"));
  });

  test("an ordinary failure shows the error and keeps the plain Merge button", async () => {
    mockedMerge.mockResolvedValue({ ok: false, error: "Contact not found" });
    const user = setupUser();
    render(<ContactMergeMenu contactId="c1" contactName="J. Smith" />);

    const input = await openDialog(user);
    await user.type(input, "smith");
    await user.click((await screen.findAllByRole("option"))[0]);
    await user.click(screen.getByRole("button", { name: "Merge contacts" }));

    expect(await screen.findByText("Contact not found")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Merge anyway" })
    ).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  test("Merge is disabled until a survivor is chosen, and reopening starts clean", async () => {
    const user = setupUser();
    render(<ContactMergeMenu contactId="c1" contactName="J. Smith" />);

    const input = await openDialog(user);
    expect(screen.getByRole("button", { name: "Merge contacts" })).toBeDisabled();

    await user.type(input, "smith");
    await user.click((await screen.findAllByRole("option"))[0]);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const reopened = await openDialog(user);
    expect(reopened).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: /clear selected contact/i })
    ).not.toBeInTheDocument();
  });
});
