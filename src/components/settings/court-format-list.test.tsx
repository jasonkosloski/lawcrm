import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  setCourtFormatActive: vi.fn(),
  deleteCourtFormat: vi.fn(),
}));
vi.mock("@/app/actions/court-formats", () => actions);

import { CourtFormatList } from "./court-format-list";

const FORMATS = [
  { id: "a", name: "CO District", courtSystem: "state" as const, isActive: true, venueCount: 2 },
  { id: "b", name: "D. Colo.", courtSystem: "federal" as const, isActive: true, venueCount: 1 },
  { id: "c", name: "Old state", courtSystem: "state" as const, isActive: false, venueCount: 0 },
];
const all = { canAdd: true, canEdit: true, canDelete: true };

beforeEach(() => Object.values(actions).forEach((f) => f.mockReset()));
afterEach(cleanup);

describe("CourtFormatList", () => {
  test("groups by court system with venue counts, skipping empty groups", () => {
    render(<CourtFormatList formats={FORMATS} {...all} />);
    expect(screen.getByRole("heading", { name: "State" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Federal" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Other" })).toBeNull();
    expect(screen.getByText("2 venues")).toBeInTheDocument();
    expect(screen.getByText("1 venue")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CO District" }).getAttribute("href")).toBe(
      "/settings/court-formats/a",
    );
  });

  test("archived rows offer Restore, active rows Archive", async () => {
    actions.setCourtFormatActive.mockResolvedValue({ ok: true });
    render(<CourtFormatList formats={FORMATS} {...all} />);
    fireEvent.click(screen.getByRole("button", { name: "Restore Old state" }));
    await waitFor(() => expect(actions.setCourtFormatActive).toHaveBeenCalledWith("c", true));
    fireEvent.click(screen.getByRole("button", { name: "Archive D. Colo." }));
    await waitFor(() => expect(actions.setCourtFormatActive).toHaveBeenCalledWith("b", false));
  });

  test("delete shows the server refusal inline", async () => {
    const msg =
      "This court format is used by: Denver. Archive it instead, or move those venues first.";
    actions.deleteCourtFormat.mockResolvedValue({ ok: false, error: msg });
    render(<CourtFormatList formats={FORMATS} {...all} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete CO District" }));
    await screen.findByText(msg);
  });

  test("controls follow permissions", () => {
    render(<CourtFormatList formats={FORMATS} canAdd={false} canEdit={false} canDelete={false} />);
    expect(screen.queryByRole("link", { name: "New court format" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Archive|Restore|Delete/ })).toBeNull();
  });

  test("empty state", () => {
    render(<CourtFormatList formats={[]} {...all} />);
    expect(screen.getByText("No court formats yet.")).toBeInTheDocument();
  });
});
