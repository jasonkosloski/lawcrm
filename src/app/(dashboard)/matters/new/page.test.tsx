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
    user: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => ({ firm: { requireOriginatingDoc: false } })),
    },
    matterDraftFile: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/draft-access", () => ({ loadAccessibleDraft: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/queries/matter-drafts", () => ({
  listMatterDrafts: vi.fn(async () => []),
}));
vi.mock("@/lib/file-storage", () => ({ activeStorageDriver: () => "local" }));
vi.mock("@/app/actions/billing/helpers", () => ({
  todayDateOnly: vi.fn(async () => new Date("2026-10-20T00:00:00Z")),
}));
vi.mock("@/components/matters/matter-drafts-list", () => ({
  MatterDraftsList: ({ drafts }: { drafts: unknown[] }) => (
    <div data-testid="drafts-list">{drafts.length}</div>
  ),
}));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn(async () => false),
}));
vi.mock("@/lib/queries/venues", () => ({
  listVenues: vi.fn(async () => [
    {
      id: "v1",
      name: "Denver",
      city: null,
      county: null,
      state: "CO",
      isActive: true,
      matterCount: 0,
    },
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
  NewMatterForm: ({
    options,
    draft,
    engagement,
  }: {
    options: Record<string, unknown>;
    draft?: unknown;
    engagement?: unknown;
  }) => (
    <div
      data-testid="new-matter-form"
      data-options={JSON.stringify(options)}
      data-draft={JSON.stringify(draft ?? null)}
      data-engagement={JSON.stringify(engagement ?? null)}
    >
      {String(options.currentUserId)}
    </div>
  ),
}));

import { prisma } from "@/lib/prisma";
import { listVenues } from "@/lib/queries/venues";
import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";
import { loadAccessibleDraft } from "@/lib/draft-access";
import { listMatterDrafts } from "@/lib/queries/matter-drafts";
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
    const o = JSON.parse(screen.getByTestId("new-matter-form").getAttribute("data-options")!);
    expect(o.venues).toHaveLength(1);
    expect(o.canAddVenue).toBe(true);
    expect(o.firmState).toBe("CO");
    expect(o.firmTemplate).toBe("{client_last}");
    expect(o.timeZone).toBe("America/Chicago");
  });

  test("lead options come from the attorney query, separate from the team pool", async () => {
    vi.mocked(requirePermission).mockResolvedValue("user_1");
    vi.mocked(prisma.user.findMany).mockImplementation((async (args: { where?: object }) =>
      args.where && "barAdmissions" in args.where
        ? [{ id: "a1", name: "Ann Atty", jobTitle: "Attorney", initials: "AA" }]
        : [
            { id: "a1", name: "Ann Atty", jobTitle: "Attorney", initials: "AA" },
            { id: "p1", name: "Pat Para", jobTitle: "Paralegal", initials: "PP" },
          ]) as never);
    render(await NewMatterPage());
    const o = JSON.parse(screen.getByTestId("new-matter-form").getAttribute("data-options")!);
    expect(o.leadUsers.map((u: { id: string }) => u.id)).toEqual(["a1"]);
    expect(o.users).toHaveLength(2);
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

describe("NewMatterPage — drafts and the Engagement section", () => {
  const attr = (name: string) =>
    JSON.parse(screen.getByTestId("new-matter-form").getAttribute(name)!);

  test("no ?draft: no draft, the drafts list gets the user's drafts, today and labels come through", async () => {
    vi.mocked(requirePermission).mockResolvedValue("user_1");
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    vi.mocked(prisma.practiceArea.findMany).mockResolvedValue([
      {
        id: "a1",
        name: "PI",
        originatingDocLabel: "Retainer",
        allowedBillingTypes: [],
        defaultBillingType: "contingent",
        stages: [],
      },
      {
        id: "a2",
        name: "Crim",
        originatingDocLabel: null,
        allowedBillingTypes: [],
        defaultBillingType: "contingent",
        stages: [],
      },
    ] as never);
    vi.mocked(listMatterDrafts).mockResolvedValue([{ id: "d1" }] as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      firm: { requireOriginatingDoc: true },
    } as never);
    render(await NewMatterPage({ searchParams: Promise.resolve({}) }));
    expect(loadAccessibleDraft).not.toHaveBeenCalled();
    expect(screen.getByTestId("drafts-list").textContent).toBe("1");
    expect(attr("data-draft")).toBeNull();
    const e = attr("data-engagement");
    expect(e).toMatchObject({
      required: true,
      canUpload: true,
      todayKey: "2026-10-20",
      labelsByArea: { a1: "Retainer", a2: "Fee agreement" },
      defaultLabel: "Fee agreement",
    });
    expect(currentUserHasPermission).toHaveBeenCalledWith("documents.upload");
  });

  test("?draft=<id> loads the accessible draft and passes the draft with its files", async () => {
    vi.mocked(requirePermission).mockResolvedValue("user_1");
    vi.mocked(loadAccessibleDraft).mockResolvedValue({
      id: "d1",
      updatedAt: new Date("2026-10-19T12:00:00Z"),
      values: { name: "Draft matter", extraTeam: "[]", junk: 5 },
    } as never);
    vi.mocked(prisma.matterDraftFile.findMany).mockResolvedValue([
      { id: "f1", name: "a.pdf", isOriginating: true },
    ] as never);
    render(await NewMatterPage({ searchParams: Promise.resolve({ draft: "d1" }) }));
    expect(loadAccessibleDraft).toHaveBeenCalledWith("user_1", "d1");
    expect(attr("data-draft")).toEqual({
      id: "d1",
      updatedAt: "2026-10-19T12:00:00.000Z",
      values: { name: "Draft matter", extraTeam: "[]" },
      files: [{ id: "f1", name: "a.pdf", isOriginating: true }],
    });
  });

  test("a missing or inaccessible draft redirects with a notice flag (same answer for both)", async () => {
    vi.mocked(requirePermission).mockResolvedValue("user_1");
    vi.mocked(loadAccessibleDraft).mockResolvedValue(null);
    await expect(
      NewMatterPage({ searchParams: Promise.resolve({ draft: "nope" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/matters/new?draftGone=1");
    expect(prisma.practiceArea.findMany).not.toHaveBeenCalled();
  });

  test("?draftGone=1 shows the one-time notice above the form", async () => {
    vi.mocked(requirePermission).mockResolvedValue("user_1");
    render(await NewMatterPage({ searchParams: Promise.resolve({ draftGone: "1" }) }));
    expect(screen.getByText("That draft is no longer available.")).toBeTruthy();
    expect(attr("data-draft")).toBeNull();
  });

  test("no notice without the flag", async () => {
    vi.mocked(requirePermission).mockResolvedValue("user_1");
    render(await NewMatterPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText("That draft is no longer available.")).toBeNull();
  });
});
