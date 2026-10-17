/**
 * PartyRowView - permission-gated controls and the contact link.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/actions/parties", () => ({
  updateMatterContact: vi.fn(),
  removeMatterContact: vi.fn(),
}));

import { PartyRowView } from "./party-row-view";
import type { PartyRow } from "@/lib/queries/matter-detail";

const party: PartyRow = {
  id: "mc1",
  contactId: "c1",
  name: "Dana Defendant",
  organization: null,
  email: null,
  phone: null,
  phones: [],
  contactType: "other",
  isPrimaryClient: false,
  category: "opposing",
  role: null,
  notes: null,
  conflictStatus: "none",
  isRepresented: null,
  representationContactId: null,
  representationName: null,
  representationFirm: null,
  representationEmail: null,
  representationPhone: null,
};

function renderRow(props: { canEdit?: boolean; canDelete?: boolean } = {}) {
  return render(
    <table>
      <tbody>
        <PartyRowView
          party={party}
          category="opposing"
          showsRepresentation
          showsOrganization
          contacts={[]}
          colSpan={7}
          {...props}
        />
      </tbody>
    </table>
  );
}

describe("PartyRowView", () => {
  test("shows edit and remove by default, naming the party", () => {
    renderRow();
    expect(
      screen.getByRole("button", { name: "Edit Dana Defendant" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Dana Defendant" })
    ).toBeInTheDocument();
  });

  test("hides the edit pencil without parties.edit", () => {
    renderRow({ canEdit: false });
    expect(screen.queryByRole("button", { name: /^edit /i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /^remove /i })
    ).toBeInTheDocument();
  });

  test("hides remove without parties.delete", () => {
    renderRow({ canDelete: false });
    expect(screen.queryByRole("button", { name: /^remove /i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /^edit /i })
    ).toBeInTheDocument();
  });

  test("the party name links to the contact record", () => {
    renderRow();
    expect(screen.getByRole("link", { name: "Dana Defendant" })).toHaveAttribute(
      "href",
      "/contacts/c1"
    );
  });
});
