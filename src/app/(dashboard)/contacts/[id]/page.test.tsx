/**
 * /contacts/[id] — merged-record redirect + permission-driven mounts.
 *
 * Pins:
 *   1. A contact with `mergedIntoId` set never renders — the page
 *      redirects to the surviving record (the whole point of keeping
 *      the loser row after a merge).
 *   2. The merge menu / log-call button only mount with their keys,
 *      and the contact-picker fetch is skipped entirely when neither
 *      consumer is visible (same chained-fetch discipline as the
 *      matter communication tab).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ContactDetail } from "@/lib/queries/contacts";

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
  ContactMergeMenu: (props: { candidates: Array<{ id: string }> }) => (
    <div
      data-testid="merge-menu"
      data-candidate-count={props.candidates.length}
    />
  ),
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
    mergedIntoId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    phones: [],
    asClientMatters: [],
    asPartyMatters: [],
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
  test("with every key: merge menu (self excluded), log-call, editable phones", async () => {
    render(await ContactDetailPage(props()));

    expect(screen.getByTestId("log-call-button")).toBeInTheDocument();
    expect(screen.getByTestId("delete-button")).toBeInTheDocument();
    expect(screen.getByTestId("conflict-control")).toBeInTheDocument();
    // Self is filtered out of the merge candidates.
    expect(screen.getByTestId("merge-menu").dataset.candidateCount).toBe("1");
    expect(screen.getByTestId("phones-card").dataset.canEdit).toBe("true");
    // One shared picker fetch feeds merge + log-call.
    expect(mockedPicker).toHaveBeenCalledTimes(1);
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
