/**
 * Edit Matter page — `matters.edit` gate on the main form.
 *
 * The `updateMatter` action already enforces `matters.edit`
 * server-side; these tests pin the read-side half: without the key
 * the page renders a read-only notice instead of a fully populated
 * form whose submit can only fail. The team card stays independently
 * gated on `matters.manage_team` — holding one key must not leak the
 * other surface.
 *
 * We do NOT re-test the form's internals or the Prisma queries here —
 * EditMatterForm owns its own validation/submit wiring. Only the
 * page's permission plumbing.
 */

import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/matter-access", () => ({
  assertMatterAccess: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    matter: { findUnique: vi.fn() },
    practiceArea: { findMany: vi.fn(async () => []) },
    contact: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
    venue: { findUnique: vi.fn(async () => null) },
    firm: {
      findFirstOrThrow: vi.fn(async () => ({
        autoAddTeamToNewEvents: true,
        autoAddTeamToUpcomingEvents: false,
      })),
    },
  },
}));
vi.mock("@/lib/queries/venues", () => ({
  listVenues: vi.fn(async () => []),
}));
vi.mock("@/lib/firm", () => ({
  getCurrentFirm: vi.fn(async () => ({ state: "CO" })),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));

// Leaf client components — they carry their own hooks / server-action
// wiring. We only care whether the page mounts them, so each becomes
// a testid stub.
// Capture the props the page hands the form (option lists, lead lock).
const formProps = vi.hoisted(() => ({
  current: undefined as
    | {
        matter: { billingType: string };
        canEditBillingType?: boolean;
        options: {
          venues?: Array<{ id: string; isActive: boolean }>;
          canAddVenue?: boolean;
          firmState?: string;
          clients: Array<{ id: string; inactive?: boolean }>;
          users: Array<{ id: string; inactive?: boolean }>;
        };
        canChangeLead?: boolean;
      }
    | undefined,
}));
const teamProps = vi.hoisted(() => ({
  current: undefined as { userOptions: Array<{ id: string }>; attorneyIds: string[] } | undefined,
}));
vi.mock("@/components/matters/edit-matter-form", () => ({
  EditMatterForm: (props: NonNullable<typeof formProps.current>) => {
    formProps.current = props;
    return <div data-testid="edit-matter-form" />;
  },
}));
vi.mock("@/components/matters/matter-team-management", () => ({
  MatterTeamManagement: (props: NonNullable<typeof teamProps.current>) => {
    teamProps.current = props;
    return <div data-testid="team-management" />;
  },
}));
vi.mock("@/components/matters/matter-restrict-card", () => ({
  MatterRestrictCard: (props: { restricted: boolean }) => (
    <div data-testid="restrict-card" data-restricted={String(props.restricted)} />
  ),
}));
vi.mock("@/components/settings/calendar-defaults-card", () => ({
  MatterCalendarDefaultsCard: () => <div data-testid="calendar-defaults-card" />,
}));

import { prisma } from "@/lib/prisma";
import { currentUserHasPermission } from "@/lib/permission-check";
import { listVenues } from "@/lib/queries/venues";
import EditMatterPage from "./page";

/** Minimal matter row satisfying every field the page reads. */
const matter = {
  id: "m1",
  name: "Doe v. Acme",
  caseNumber: "2026-CV-001",
  practiceAreaId: "pa1",
  stageId: "st1",
  feeStructure: "contingent",
  billingMode: "client",
  court: null,
  clientId: "c1",
  opposingParty: null,
  opposingFirm: null,
  description: null,
  incidentDate: null,
  statuteOfLimitationsDate: null,
  statuteOfLimitationsNotes: null,
  autoAddTeamToNewEvents: null,
  autoAddTeamToUpcomingEvents: null,
  teamMembers: [],
};

/** Grant exactly these permission keys; everything else denies. */
const grant = (...keys: string[]) =>
  vi.mocked(currentUserHasPermission).mockImplementation(async (key) => keys.includes(key));

const renderPage = async () => {
  vi.mocked(prisma.matter.findUnique).mockResolvedValue(
    matter as unknown as Awaited<ReturnType<typeof prisma.matter.findUnique>>,
  );
  render(
    await EditMatterPage({
      params: Promise.resolve({ id: "m1" }),
    } as Parameters<typeof EditMatterPage>[0]),
  );
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("EditMatterPage — matters.edit gate", () => {
  test("without matters.edit — form is replaced by the read-only notice", async () => {
    grant(); // page access only, no matter keys
    await renderPage();
    expect(screen.queryByTestId("edit-matter-form")).toBeNull();
    expect(screen.getByText(/read-only for your role/i)).toBeTruthy();
  });

  test("with matters.edit — form renders, notice is absent", async () => {
    grant("matters.edit");
    await renderPage();
    expect(screen.getByTestId("edit-matter-form")).toBeTruthy();
    expect(screen.queryByText(/read-only for your role/i)).toBeNull();
  });

  test("manage_team without edit — team card renders while the form stays gated", async () => {
    grant("matters.manage_team");
    await renderPage();
    expect(screen.getByTestId("team-management")).toBeTruthy();
    expect(screen.queryByTestId("edit-matter-form")).toBeNull();
  });

  test("edit without manage_team — form renders, team card stays gated", async () => {
    grant("matters.edit");
    await renderPage();
    expect(screen.getByTestId("edit-matter-form")).toBeTruthy();
    expect(screen.queryByTestId("team-management")).toBeNull();
  });
});

describe("EditMatterPage — matters.restrict gate (ADR-049)", () => {
  test("the restrict card renders only with matters.restrict", async () => {
    grant("matters.edit");
    await renderPage();
    expect(screen.queryByTestId("restrict-card")).toBeNull();
  });

  test("with matters.restrict the card gets the matter's flag", async () => {
    grant("matters.restrict");
    vi.mocked(prisma.matter.findUnique).mockResolvedValue({
      ...matter,
      restricted: true,
    } as unknown as Awaited<ReturnType<typeof prisma.matter.findUnique>>);
    render(
      await EditMatterPage({
        params: Promise.resolve({ id: "m1" }),
      } as Parameters<typeof EditMatterPage>[0]),
    );
    expect(screen.getByTestId("restrict-card").dataset.restricted).toBe("true");
  });
});

describe("EditMatterPage — option lists keep the current client and lead (F082/F311)", () => {
  const withTeam = {
    ...matter,
    teamMembers: [
      {
        id: "tm1",
        userId: "u-lead",
        role: "lead",
        removedAt: null,
        createdAt: new Date(),
        user: { id: "u-lead", name: "Dana Lead", jobTitle: "Attorney", initials: "DL" },
      },
    ],
  };

  test("client and user queries always include the matter's current client and active lead", async () => {
    grant("matters.edit");
    vi.mocked(prisma.matter.findUnique).mockResolvedValue(
      withTeam as unknown as Awaited<ReturnType<typeof prisma.matter.findUnique>>,
    );
    render(
      await EditMatterPage({
        params: Promise.resolve({ id: "m1" }),
      } as Parameters<typeof EditMatterPage>[0]),
    );
    const clientWhere = vi.mocked(prisma.contact.findMany).mock.calls[0][0]!.where;
    expect(clientWhere).toEqual({
      OR: [{ type: "client", isActive: true }, { id: "c1" }],
    });
    const userWhere = vi.mocked(prisma.user.findMany).mock.calls[0][0]!.where;
    expect(userWhere).toEqual({
      OR: [{ isActive: true }, { id: "u-lead" }],
    });
  });

  test("inactive rows are flagged for the form and kept out of the team card's picker", async () => {
    grant("matters.edit", "matters.manage_team");
    vi.mocked(prisma.matter.findUnique).mockResolvedValue(
      withTeam as unknown as Awaited<ReturnType<typeof prisma.matter.findUnique>>,
    );
    vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([
      { id: "c1", name: "Maria", organization: null, isActive: false },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([
      { id: "u-lead", name: "Dana Lead", jobTitle: "Attorney", isActive: false, barAdmissions: [] },
      {
        id: "u2",
        name: "Eli Active",
        jobTitle: "Paralegal",
        isActive: true,
        barAdmissions: [{ id: "b1" }],
      },
      { id: "u3", name: "Pat Para", jobTitle: "Paralegal", isActive: true, barAdmissions: [] },
    ] as never);
    render(
      await EditMatterPage({
        params: Promise.resolve({ id: "m1" }),
      } as Parameters<typeof EditMatterPage>[0]),
    );
    expect(formProps.current?.options.clients).toEqual([
      expect.objectContaining({ id: "c1", inactive: true }),
    ]);
    // Lead options: attorneys plus the current lead (grandfathered), not Pat.
    expect(formProps.current?.options.users).toEqual([
      expect.objectContaining({ id: "u-lead", inactive: true }),
      expect.objectContaining({ id: "u2", inactive: false }),
    ]);
    // Team card never offers the departed user, and only attorneys can be lead.
    expect(teamProps.current?.userOptions.map((u) => u.id)).toEqual(["u2", "u3"]);
    expect(teamProps.current?.attorneyIds).toEqual(["u2"]);
  });

  test("the lead field is only unlocked with matters.manage_team (F138/F300/F767)", async () => {
    grant("matters.edit");
    await renderPage();
    expect(formProps.current?.canChangeLead).toBe(false);
  });

  test("the billing type is locked without matters.billing_type.edit and unlocked with it", async () => {
    grant("matters.edit");
    await renderPage();
    expect(formProps.current?.canEditBillingType).toBe(false);
    expect(formProps.current?.matter.billingType).toBe("contingent");
    grant("matters.edit", "matters.billing_type.edit");
    await renderPage();
    expect(formProps.current?.canEditBillingType).toBe(true);
  });

  test("manage_team unlocks the lead field", async () => {
    grant("matters.edit", "matters.manage_team");
    await renderPage();
    expect(formProps.current?.canChangeLead).toBe(true);
  });
});

describe("EditMatterPage — venue options", () => {
  const venue = (id: string, isActive: boolean) => ({
    id,
    name: id,
    city: null,
    county: null,
    state: "CO",
    isActive,
    matterCount: 0,
  });

  test("passes active venues, add permission and firm state", async () => {
    grant("matters.edit", "venues.add");
    vi.mocked(listVenues).mockResolvedValueOnce([venue("v1", true)]);
    await renderPage();
    expect(listVenues).toHaveBeenCalledWith({ activeOnly: true });
    expect(formProps.current?.options.venues?.map((v) => v.id)).toEqual(["v1"]);
    expect(formProps.current?.options.canAddVenue).toBe(true);
    expect(formProps.current?.options.firmState).toBe("CO");
  });

  test("includes the matter's archived current venue", async () => {
    grant("matters.edit");
    vi.mocked(listVenues).mockResolvedValueOnce([venue("v1", true)]);
    vi.mocked(prisma.venue.findUnique).mockResolvedValueOnce(venue("v-old", false) as never);
    vi.mocked(prisma.matter.findUnique).mockResolvedValue({
      ...matter,
      venueId: "v-old",
    } as never);
    render(
      await EditMatterPage({
        params: Promise.resolve({ id: "m1" }),
      } as Parameters<typeof EditMatterPage>[0]),
    );
    expect(formProps.current?.options.venues).toEqual([
      expect.objectContaining({ id: "v1" }),
      expect.objectContaining({ id: "v-old", isActive: false }),
    ]);
  });
});
