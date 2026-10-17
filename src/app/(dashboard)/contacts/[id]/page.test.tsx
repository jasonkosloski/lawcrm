/**
 * /contacts/[id] — merged-record redirect + permission-driven mounts.
 *
 * Pins:
 *   1. A contact with `mergedIntoId` set never renders — the page
 *      redirects to the surviving record (the whole point of keeping
 *      the loser row after a merge).
 *   2. The merge menu / log-call button only mount with their keys.
 *      The page never fetches the contact-picker list (log-call is
 *      pinned to this contact; the merge dialog searches on the
 *      server), and skips the matter-options fetch when the log-call
 *      button isn't visible.
 *   3. A deactivated contact is labelled "Inactive", offers Reactivate
 *      instead of Delete, and hides Merge / Log call.
 *   4. The Matters card counts DISTINCT matters and lists the parties
 *      a contact represents (opposing counsel has no party row).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ContactDetail } from "@/lib/queries/contacts";

// Page auth guard (src/lib/current-user.ts) — session exists here.
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/queries/contacts", () => ({
  getContactById: vi.fn(),
  listContactPickerOptions: vi.fn(),
}));
vi.mock("@/lib/queries/communication", () => ({
  getFilingMatterOptions: vi.fn(),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));

// Leaf components — the tests only care whether the page mounts them,
// not their markup. TopBar pulls in provider hooks, so stub it too
// (render actions/subtitle so presence assertions work).
vi.mock("@/components/layout/topbar", () => ({
  TopBar: (props: {
    actions?: React.ReactNode;
    subtitle?: React.ReactNode;
  }) => (
    <div data-testid="topbar">
      {props.subtitle}
      {props.actions}
    </div>
  ),
}));
vi.mock("@/components/contacts/contact-delete-button", () => ({
  ContactDeleteButton: () => <div data-testid="delete-button" />,
}));
vi.mock("@/components/contacts/contact-merge-menu", () => ({
  ContactMergeMenu: () => <div data-testid="merge-menu" />,
}));
vi.mock("@/components/contacts/contact-reactivate-button", () => ({
  ContactReactivateButton: () => <div data-testid="reactivate-button" />,
}));
vi.mock("@/components/contacts/contact-phones-card", () => ({
  ContactPhonesCard: (props: { canEdit: boolean }) => (
    <div data-testid="phones-card" data-can-edit={String(props.canEdit)} />
  ),
}));
vi.mock("@/components/contacts/conflict-status-control", () => ({
  ConflictStatusControl: () => <div data-testid="conflict-control" />,
}));
vi.mock("@/components/communication/log-call-button", () => ({
  LogCallButton: () => <div data-testid="log-call-button" />,
}));

import { redirect } from "next/navigation";
import {
  getContactById,
  listContactPickerOptions,
} from "@/lib/queries/contacts";
import { getFilingMatterOptions } from "@/lib/queries/communication";
import { currentUserHasPermission } from "@/lib/permission-check";
import ContactDetailPage from "./page";

const mockedGetContact = vi.mocked(getContactById);
const mockedPicker = vi.mocked(listContactPickerOptions);
const mockedFiling = vi.mocked(getFilingMatterOptions);
const mockedHasPermission = vi.mocked(currentUserHasPermission);

const props = (id = "c1") =>
  ({
    params: Promise.resolve({ id }),
  }) as Parameters<typeof ContactDetailPage>[0];

function contactDetail(overrides: Partial<ContactDetail> = {}): ContactDetail {
  return {
    id: "c1",
    name: "Dana Whitfield",
    type: "client",
    organization: null,
    email: null,
    phone: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    notes: null,
    conflictStatus: "clear",
    isActive: true,
    mergedIntoId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    phones: [],
    asClientMatters: [],
    asPartyMatters: [],
    representing: [],
    matterCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetContact.mockResolvedValue(contactDetail());
  mockedPicker.mockResolvedValue([
    { id: "c1", name: "Dana Whitfield", type: "client", organization: null, phone: null },
    { id: "c2", name: "Other Person", type: "other", organization: null, phone: null },
  ]);
  mockedFiling.mockResolvedValue([]);
  mockedHasPermission.mockResolvedValue(true);
});

describe("merged-record redirect", () => {
  test("a merged-away contact redirects to the survivor", async () => {
    mockedGetContact.mockResolvedValue(
      contactDetail({ mergedIntoId: "c_survivor" })
    );

    await expect(ContactDetailPage(props())).rejects.toThrow(
      "REDIRECT:/contacts/c_survivor"
    );
    expect(redirect).toHaveBeenCalledWith("/contacts/c_survivor");
  });

  test("an unknown id 404s", async () => {
    mockedGetContact.mockResolvedValue(null);
    await expect(ContactDetailPage(props("nope"))).rejects.toThrow(
      "NOT_FOUND"
    );
  });
});

describe("permission-driven mounts", () => {
  test("with every key: merge menu, log-call, editable phones", async () => {
    render(await ContactDetailPage(props()));

    expect(screen.getByTestId("log-call-button")).toBeInTheDocument();
    expect(screen.getByTestId("delete-button")).toBeInTheDocument();
    expect(screen.getByTestId("conflict-control")).toBeInTheDocument();
    expect(screen.getByTestId("merge-menu")).toBeInTheDocument();
    expect(screen.queryByTestId("reactivate-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("phones-card").dataset.canEdit).toBe("true");
    // The log-call button is pinned to this contact (fixedContact), so
    // the 500-row picker list is never fetched for the detail page.
    expect(mockedPicker).not.toHaveBeenCalled();
    expect(mockedFiling).toHaveBeenCalledTimes(1);
  });

  test("merge without log-call needs no picker fetch (the dialog searches on the server)", async () => {
    mockedHasPermission.mockImplementation(
      async (key: string) => key === "contacts.merge"
    );

    render(await ContactDetailPage(props()));

    expect(screen.getByTestId("merge-menu")).toBeInTheDocument();
    expect(mockedPicker).not.toHaveBeenCalled();
  });

  test("with no keys: read-only page, no picker or matter fetches", async () => {
    mockedHasPermission.mockResolvedValue(false);

    render(await ContactDetailPage(props()));

    expect(screen.queryByTestId("log-call-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("merge-menu")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("conflict-control")).not.toBeInTheDocument();
    expect(screen.getByTestId("phones-card").dataset.canEdit).toBe("false");
    expect(mockedPicker).not.toHaveBeenCalled();
    expect(mockedFiling).not.toHaveBeenCalled();
  });
});

describe("deactivated contact", () => {
  test("shows an Inactive badge, offers Reactivate, and hides Merge / Log call", async () => {
    mockedGetContact.mockResolvedValue(contactDetail({ isActive: false }));

    render(await ContactDetailPage(props()));

    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByTestId("reactivate-button")).toBeInTheDocument();
    expect(screen.queryByTestId("delete-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("merge-menu")).not.toBeInTheDocument();
    expect(screen.queryByTestId("log-call-button")).not.toBeInTheDocument();
    expect(mockedPicker).not.toHaveBeenCalled();
  });

  test("an active contact has no Inactive badge", async () => {
    render(await ContactDetailPage(props()));
    expect(screen.queryByText("Inactive")).not.toBeInTheDocument();
  });

  test("Reactivate needs contacts.delete", async () => {
    mockedGetContact.mockResolvedValue(contactDetail({ isActive: false }));
    mockedHasPermission.mockImplementation(
      async (key: string) => key !== "contacts.delete"
    );

    render(await ContactDetailPage(props()));

    expect(screen.queryByTestId("reactivate-button")).not.toBeInTheDocument();
  });
});

describe("Matters card", () => {
  test("shows the distinct-matter count, a Represents row, and archived tags", async () => {
    mockedGetContact.mockResolvedValue(
      contactDetail({
        type: "opposing_counsel",
        asClientMatters: [],
        asPartyMatters: [],
        representing: [
          {
            id: "mc1",
            matterId: "m1",
            matterName: "Whitfield v. City",
            matterColor: "#123456",
            partyName: "City of Denver",
            isArchived: false,
          },
          {
            id: "mc2",
            matterId: "m2",
            matterName: "Old Matter",
            matterColor: "#654321",
            partyName: "Officer Jones",
            isArchived: true,
          },
        ],
        matterCount: 2,
      })
    );

    render(await ContactDetailPage(props()));

    expect(screen.queryByText("Not linked to any matter yet.")).toBeNull();
    expect(screen.getByText("Whitfield v. City")).toBeInTheDocument();
    expect(screen.getByText("Represents City of Denver")).toBeInTheDocument();
    expect(screen.getByText("Represents Officer Jones")).toBeInTheDocument();
    expect(screen.getByText("archived")).toBeInTheDocument();
    expect(
      screen.getByText("2", { selector: "span.font-mono" })
    ).toBeInTheDocument();
  });

  test("empty state when the contact touches no matter", async () => {
    render(await ContactDetailPage(props()));
    expect(
      screen.getByText("Not linked to any matter yet.")
    ).toBeInTheDocument();
  });
});
