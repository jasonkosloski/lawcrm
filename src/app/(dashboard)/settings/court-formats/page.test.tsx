/**
 * /settings/court-formats — page gate and list data.
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
const findMany = vi.fn(async () => [
  { id: "a", name: "CO District", courtSystem: "state", isActive: true, _count: { venues: 3 } },
]);
vi.mock("@/lib/prisma", () => ({ prisma: { courtFormat: { findMany: () => findMany() } } }));
vi.mock("@/components/settings/court-format-list", () => ({
  CourtFormatList: ({ formats }: { formats: { name: string; venueCount: number }[] }) => (
    <ul>
      {formats.map((f) => (
        <li key={f.name}>
          {f.name} {f.venueCount}
        </li>
      ))}
    </ul>
  ),
}));

import { currentUserHasAnyPermission } from "@/lib/permission-check";
import CourtFormatsPage from "./page";

beforeEach(() => vi.clearAllMocks());

describe("/settings/court-formats", () => {
  test("without any court-format key: notFound and no reads", async () => {
    vi.mocked(currentUserHasAnyPermission).mockResolvedValue(false);
    await expect(CourtFormatsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(currentUserHasAnyPermission).toHaveBeenCalledWith([
      "court_formats.add",
      "court_formats.edit",
      "court_formats.delete",
    ]);
    expect(findMany).not.toHaveBeenCalled();
  });

  test("with a key: lists formats with venue counts", async () => {
    vi.mocked(currentUserHasAnyPermission).mockResolvedValue(true);
    render(await CourtFormatsPage());
    expect(screen.getByText("CO District 3")).toBeInTheDocument();
  });
});
