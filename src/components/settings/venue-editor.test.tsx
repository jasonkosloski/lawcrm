import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({
  createVenue: vi.fn(),
  updateVenue: vi.fn(),
  setVenueActive: vi.fn(),
  deleteVenue: vi.fn(),
}));
vi.mock("@/app/actions/venues", () => actions);

import { VenueEditor } from "./venue-editor";

const used = { id: "v1", name: "Aurora", city: "Aurora", county: "Arapahoe", state: "CO", isActive: true, matterCount: 2 };
const unused = { id: "v2", name: "Denver", city: null, county: null, state: "CO", isActive: true, matterCount: 0 };
const archived = { id: "v3", name: "Old Court", city: null, county: null, state: "CO", isActive: false, matterCount: 1 };
const all = { canAdd: true, canEdit: true, canDelete: true };

beforeEach(() => Object.values(actions).forEach((f) => f.mockReset()));

describe("VenueEditor", () => {
  test("renders columns, counts and archived status", () => {
    render(<VenueEditor venues={[used, archived]} {...all} />);
    expect(screen.getByText("Matters")).toBeInTheDocument();
    expect(screen.getByText("Arapahoe")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Old Court" })).toBeInTheDocument();
  });

  test("hides Delete for a used venue, shows it for an unused one", () => {
    render(<VenueEditor venues={[used, unused]} {...all} />);
    expect(screen.queryByRole("button", { name: "Delete Aurora" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete Denver" })).toBeInTheDocument();
  });

  test("hides Add without venues.add; hides row controls without keys", () => {
    render(<VenueEditor venues={[unused, archived]} canAdd={false} canEdit={false} canDelete={false} />);
    expect(screen.queryByRole("button", { name: /add venue/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Denver" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive Denver" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore Old Court" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Denver" })).toBeNull();
  });

  test("restore calls setVenueActive(id, true)", async () => {
    actions.setVenueActive.mockResolvedValue({ ok: true });
    render(<VenueEditor venues={[archived]} {...all} />);
    await userEvent.click(screen.getByRole("button", { name: "Restore Old Court" }));
    await waitFor(() => expect(actions.setVenueActive).toHaveBeenCalledWith("v3", true));
  });

  test("add dialog submits createVenue", async () => {
    actions.createVenue.mockResolvedValue({ ok: true, venue: unused });
    render(<VenueEditor venues={[]} {...all} defaultState="CO" />);
    await userEvent.click(screen.getByRole("button", { name: /add venue/i }));
    await userEvent.type(screen.getByLabelText(/^name/i), "Boulder");
    expect(screen.getByLabelText(/^state/i)).toHaveValue("CO");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(actions.createVenue).toHaveBeenCalledWith({ name: "Boulder", city: "", county: "", state: "CO" })
    );
  });

  test("new venue state is blank without a default", async () => {
    render(<VenueEditor venues={[]} {...all} />);
    await userEvent.click(screen.getByRole("button", { name: /add venue/i }));
    expect(screen.getByLabelText(/^state/i)).toHaveValue("");
  });

  test("shows delete error", async () => {
    actions.deleteVenue.mockResolvedValue({ ok: false, error: "A matter uses this venue. Archive it instead." });
    render(<VenueEditor venues={[unused]} {...all} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Denver" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Archive it instead");
  });
});
