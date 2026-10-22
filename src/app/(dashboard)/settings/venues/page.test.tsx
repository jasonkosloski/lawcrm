/**
 * /settings/venues — page gate.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn(async () => "user_1") }));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasAnyPermission: vi.fn(),
  currentUserHasPermission: vi.fn(async () => true),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { courtFormat: { findMany: vi.fn(async () => []) } },
}));
vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn(async () => ({ state: "WY" })) }));
vi.mock("@/lib/queries/venues", () => ({
  listVenues: vi.fn(async () => [
    {
      id: "v1",
      name: "Aurora",
      city: null,
      county: null,
      state: "CO",
      isActive: true,
      matterCount: 3,
    },
  ]),
}));
vi.mock("@/components/settings/venue-editor", () => ({
  VenueEditor: ({
    venues,
    defaultState,
  }: {
    venues: { name: string; matterCount: number }[];
    defaultState: string;
  }) => (
    <ul data-state={defaultState}>
      {venues.map((v) => (
        <li key={v.name}>
          {v.name} {v.matterCount}
        </li>
      ))}
    </ul>
  ),
}));

import { currentUserHasAnyPermission } from "@/lib/permission-check";
import { listVenues } from "@/lib/queries/venues";
import VenuesPage from "./page";

beforeEach(() => vi.clearAllMocks());

describe("/settings/venues", () => {
  test("without any venue key: notFound and no reads", async () => {
    vi.mocked(currentUserHasAnyPermission).mockResolvedValue(false);
    await expect(VenuesPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(currentUserHasAnyPermission).toHaveBeenCalledWith([
      "venues.add",
      "venues.edit",
      "venues.delete",
    ]);
    expect(listVenues).not.toHaveBeenCalled();
  });

  test("with a key: lists all venues including archived, with counts", async () => {
    vi.mocked(currentUserHasAnyPermission).mockResolvedValue(true);
    render(await VenuesPage());
    expect(listVenues).toHaveBeenCalledWith({ activeOnly: false });
    expect(screen.getByText("Aurora 3")).toBeInTheDocument();
    expect(document.querySelector("ul")).toHaveAttribute("data-state", "WY");
  });
});
