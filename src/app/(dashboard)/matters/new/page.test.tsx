/**
 * New Matter page — `matters.create` gate.
 *
 * `createMatter` already enforces `matters.create` on submit (and its
 * denial redirects to "/", throwing away everything typed). These
 * tests pin the read-side half: a user without the key never sees the
 * form, and no dropdown data is read for them. The page also doubles
 * as the session guard (requirePermission authenticates first).
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    practiceArea: { findMany: vi.fn(async () => []) },
    contact: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn(async () => false),
}));
vi.mock("@/lib/queries/venues", () => ({
  listVenues: vi.fn(async () => [
    { id: "v1", name: "Denver", city: null, county: null, state: "CO", isActive: true, matterCount: 0 },
  ]),
}));
vi.mock("@/lib/firm", () => ({
  getCurrentFirm: vi.fn(async () => ({ state: "CO", matterNameTemplate: "{client_last}" })),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Chicago"),
}));
vi.mock("@/components/layout/topbar", () => ({ TopBar: () => null }));
vi.mock("@/components/matters/new-matter-form", () => ({
  NewMatterForm: ({ options }: { options: Record<string, unknown> }) => (
    <div data-testid="new-matter-form" data-options={JSON.stringify(options)}>
      {String(options.currentUserId)}
    </div>
  ),
}));

import { prisma } from "@/lib/prisma";
import { listVenues } from "@/lib/queries/venues";
import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";
import NewMatterPage from "./page";

afterEach(() => vi.clearAllMocks());

describe("NewMatterPage — matters.create gate", () => {
  test("requires matters.create and renders the form with the user id", async () => {
    vi.mocked(requirePermission).mockResolvedValue("user_1");
    render(await NewMatterPage());
    expect(requirePermission).toHaveBeenCalledWith("matters.create");
    expect(screen.getByTestId("new-matter-form").textContent).toBe("user_1");
  });

  test("passes venues, firm template/state, canAddVenue and the user zone", async () => {
    vi.mocked(requirePermission).mockResolvedValue("user_1");
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    render(await NewMatterPage());
    expect(listVenues).toHaveBeenCalledWith({ activeOnly: true });
    expect(currentUserHasPermission).toHaveBeenCalledWith("venues.add");
    const o = JSON.parse(
      screen.getByTestId("new-matter-form").getAttribute("data-options")!
    );
    expect(o.venues).toHaveLength(1);
    expect(o.canAddVenue).toBe(true);
    expect(o.firmState).toBe("CO");
    expect(o.firmTemplate).toBe("{client_last}");
    expect(o.timeZone).toBe("America/Chicago");
  });

  test("a denied user is bounced before any data is read or the form renders", async () => {
    // The real requirePermission redirects (throws) on denial.
    vi.mocked(requirePermission).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(NewMatterPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(prisma.practiceArea.findMany).not.toHaveBeenCalled();
    expect(prisma.contact.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
