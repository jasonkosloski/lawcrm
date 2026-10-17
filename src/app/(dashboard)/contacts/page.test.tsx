/**
 * /contacts directory page.
 *
 * Pins the truncation notice (the list is capped at CONTACT_LIST_LIMIT
 * while the "All" pill shows the true total - without the notice
 * everyone past the cut is silently invisible), the labelled search
 * box, and that the raw `q` is handed to the query (trimming and case
 * folding live in listContacts).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CONTACT_LIST_LIMIT } from "@/lib/contact-constants";
import type { ContactListRow } from "@/lib/queries/contacts";

vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/queries/contacts", async () => {
  const constants = await import("@/lib/contact-constants");
  return {
    CONTACT_TYPES: constants.CONTACT_TYPES,
    CONTACT_TYPE_LABEL: constants.CONTACT_TYPE_LABEL,
    listContacts: vi.fn(),
    getContactTypeCounts: vi.fn(),
  };
});
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(async () => true),
}));
vi.mock("@/components/layout/topbar", () => ({
  TopBar: () => <div data-testid="topbar" />,
}));
vi.mock("@/components/contacts/contacts-table", () => ({
  ContactsTable: (props: { rows: unknown[] }) => (
    <div data-testid="table" data-rows={props.rows.length} />
  ),
}));

import { getContactTypeCounts, listContacts } from "@/lib/queries/contacts";
import ContactsPage from "./page";

const mockedList = vi.mocked(listContacts);
const mockedCounts = vi.mocked(getContactTypeCounts);

const row = (i: number): ContactListRow => ({
  id: `c${i}`,
  name: `Person ${i}`,
  type: "client",
  organization: null,
  email: null,
  phone: null,
  conflictStatus: "clear",
  matterCount: 0,
});

const props = (sp: Record<string, string> = {}) =>
  ({ searchParams: Promise.resolve(sp) }) as Parameters<typeof ContactsPage>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mockedCounts.mockResolvedValue({ client: 3 });
});

describe("ContactsPage", () => {
  test("a short list shows no truncation notice", async () => {
    mockedList.mockResolvedValue([row(1), row(2), row(3)]);
    render(await ContactsPage(props()));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  test("a list that hit the cap says so", async () => {
    mockedList.mockResolvedValue(
      Array.from({ length: CONTACT_LIST_LIMIT }, (_, i) => row(i))
    );
    render(await ContactsPage(props()));
    expect(screen.getByRole("status")).toHaveTextContent(
      `Showing the first ${CONTACT_LIST_LIMIT} contacts`
    );
  });

  test("the search box is labelled and the raw query reaches listContacts", async () => {
    mockedList.mockResolvedValue([row(1)]);
    render(await ContactsPage(props({ q: " whitfield ", type: "client" })));

    expect(
      screen.getByRole("searchbox", { name: "Search contacts" })
    ).toHaveValue(" whitfield ");
    expect(mockedList).toHaveBeenCalledWith({
      search: " whitfield ",
      type: "client",
    });
  });
});
