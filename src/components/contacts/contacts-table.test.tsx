/**
 * Tests for the contacts directory table's bulk selection.
 *
 * What's pinned here:
 *   - selection state: row checkbox shows the bar with a live count,
 *     header checkbox selects/clears the whole page, Clear resets;
 *   - Set type wires the selected ids + chosen type to
 *     `bulkSetContactType`, clears the selection and refreshes on
 *     success, alerts + keeps the selection on failure;
 *   - Deactivate asks confirm() first (cancel = no action call) and
 *     wires the ids to `bulkDeactivateContacts`;
 *   - Export CSV wires the ids to `exportContactsCsv` and funnels the
 *     result through a blob download (no permission flag needed);
 *   - permission flags: canEdit/canDelete hide their controls while
 *     Export stays;
 *   - the BULK_CONTACT_LIMIT guard swaps the actions for a trim note
 *     when the selection is over the cap.
 *
 * The actions are mocked at module level (TESTING.md layer-2 idiom);
 * their validation/DB behavior is covered in contacts.test.ts.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/app/actions/contacts", () => ({
  bulkDeactivateContacts: vi.fn(),
  bulkSetContactType: vi.fn(),
  exportContactsCsv: vi.fn(),
}));

import {
  bulkDeactivateContacts,
  bulkSetContactType,
  exportContactsCsv,
} from "@/app/actions/contacts";
import { BULK_CONTACT_LIMIT } from "@/lib/contact-constants";
import type { ContactListRow } from "@/lib/queries/contacts";
import { ContactsTable } from "./contacts-table";

const mockedSetType = vi.mocked(bulkSetContactType);
const mockedDeactivate = vi.mocked(bulkDeactivateContacts);
const mockedExport = vi.mocked(exportContactsCsv);

function row(
  overrides: Partial<ContactListRow> & { id: string; name: string }
): ContactListRow {
  return {
    type: "client",
    organization: null,
    email: null,
    phone: null,
    conflictStatus: "clear",
    matterCount: 0,
    ...overrides,
  };
}

const rows = [row({ id: "c1", name: "Alpha" }), row({ id: "c2", name: "Beta" })];

function renderTable(props?: Partial<Parameters<typeof ContactsTable>[0]>) {
  return render(
    <ContactsTable rows={rows} canEdit canDelete {...props} />
  );
}

// happy-dom doesn't implement alert/confirm — stub them as globals
// (vi.spyOn(window, "alert") throws "can only spy on a function").
const alertMock = vi.fn();
const confirmMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockedSetType.mockResolvedValue({ ok: true, count: 2 });
  mockedDeactivate.mockResolvedValue({ ok: true, count: 2 });
  mockedExport.mockResolvedValue({
    ok: true,
    csv: "Name\r\nAlpha\r\n",
    filename: "contacts-export-2026-07-07.csv",
  });
  confirmMock.mockReturnValue(true);
  vi.stubGlobal("alert", alertMock);
  vi.stubGlobal("confirm", confirmMock);
  // happy-dom lacks object URLs; the download path needs both plus a
  // click that doesn't try to navigate.
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

describe("ContactsTable — selection", () => {
  test("no bulk bar until a row is checked; count tracks the selection", async () => {
    const user = userEvent.setup();
    renderTable();
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Select Beta" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  test("header checkbox selects the whole page and Clear resets", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(
      screen.getByRole("checkbox", { name: "Select all contacts" })
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });
});

describe("ContactsTable — set type", () => {
  test("sends the selected ids + type, then clears and refreshes", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(
      screen.getByRole("checkbox", { name: "Select all contacts" })
    );
    await user.selectOptions(screen.getByLabelText("Set type"), "witness");

    expect(mockedSetType).toHaveBeenCalledWith(["c1", "c2"], "witness");
    await waitFor(() =>
      expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
    );
    expect(refresh).toHaveBeenCalled();
  });

  test("keeps the selection and alerts on failure", async () => {
    mockedSetType.mockResolvedValue({ ok: false, error: "Nope" });
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    await user.selectOptions(screen.getByLabelText("Set type"), "expert");

    await waitFor(() => expect(alertMock).toHaveBeenCalledWith("Nope"));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("ContactsTable — deactivate", () => {
  test("confirms first and sends the selected ids", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(
      screen.getByRole("checkbox", { name: "Select all contacts" })
    );
    await user.click(screen.getByRole("button", { name: /Deactivate/ }));

    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining("Deactivate 2 contacts?")
    );
    expect(mockedDeactivate).toHaveBeenCalledWith(["c1", "c2"]);
    await waitFor(() =>
      expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
    );
  });

  test("cancelling the confirm never calls the action", async () => {
    confirmMock.mockReturnValue(false);
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    await user.click(screen.getByRole("button", { name: /Deactivate/ }));

    expect(mockedDeactivate).not.toHaveBeenCalled();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });
});

describe("ContactsTable — export", () => {
  test("sends the selected ids and downloads the returned CSV", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("checkbox", { name: "Select Beta" }));
    await user.click(screen.getByRole("button", { name: /Export CSV/ }));

    expect(mockedExport).toHaveBeenCalledWith(["c2"]);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    // Export leaves the selection intact — no mutation happened.
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });
});

describe("ContactsTable — permissions + cap", () => {
  test("canEdit=false / canDelete=false leave only Export in the bar", async () => {
    const user = userEvent.setup();
    renderTable({ canEdit: false, canDelete: false });

    await user.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    expect(
      screen.getByRole("button", { name: /Export CSV/ })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Set type")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Deactivate/ })
    ).not.toBeInTheDocument();
  });

  test("over the batch cap: actions swap for a trim note", async () => {
    const many = Array.from({ length: BULK_CONTACT_LIMIT + 1 }, (_, i) =>
      row({ id: `c${i}`, name: `Contact ${i}` })
    );
    const user = userEvent.setup();
    render(<ContactsTable rows={many} canEdit canDelete />);

    await user.click(
      screen.getByRole("checkbox", { name: "Select all contacts" })
    );
    expect(
      screen.getByText(`${BULK_CONTACT_LIMIT + 1} selected`)
    ).toBeInTheDocument();
    expect(screen.getByText(/trim the selection/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Export CSV/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Set type")).not.toBeInTheDocument();
  });
});
