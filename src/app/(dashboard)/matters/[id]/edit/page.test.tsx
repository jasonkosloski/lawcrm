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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    matter: { findUnique: vi.fn() },
    practiceArea: { findMany: vi.fn(async () => []) },
    contact: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
    firm: {
      findFirstOrThrow: vi.fn(async () => ({
        autoAddTeamToNewEvents: true,
        autoAddTeamToUpcomingEvents: false,
      })),
    },
  },
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
        options: {
          clients: Array<{ id: string; inactive?: boolean }>;
          users: Array<{ id: string; inactive?: boolean }>;
        };
        canChangeLead?: boolean;
      }
    | undefined,
}));
const teamProps = vi.hoisted(() => ({
  current: undefined as
    | { userOptions: Array<{ id: string }> }
    | undefined,
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
vi.mock("@/components/settings/calendar-defaults-card", () => ({
  MatterCalendarDefaultsCard: () => (
    <div data-testid="calendar-defaults-card" />
  ),
}));

import { prisma } from "@/lib/prisma";
import { currentUserHasPermission } from "@/lib/permission-check";
import EditMatterPage from "./page";

/** Minimal matter row satisfying every field the page reads. */
const matter = {
  id: "m1",
  name: "Doe v. Acme",
  caseNumber: "2026-CV-001",
  practiceAreaId: "pa1",
  stageId: "st1",
  feeStructure: "contingency",
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
  vi
    .mocked(currentUserHasPermission)
    .mockImplementation(async (key) => keys.includes(key));

const renderPage = async () => {
  vi.mocked(prisma.matter.findUnique).mockResolvedValue(
    matter as unknown as Awaited<ReturnType<typeof prisma.matter.findUnique>>
  );
  render(
    await EditMatterPage({
      params: Promise.resolve({ id: "m1" }),
    } as Parameters<typeof EditMatterPage>[0])
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
    expect(
      screen.getByText(/read-only for your role/i)
    ).toBeTruthy();
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
      withTeam as unknown as Awaited<ReturnType<typeof prisma.matter.findUnique>>
    );
    render(
      await EditMatterPage({
        params: Promise.resolve({ id: "m1" }),
      } as Parameters<typeof EditMatterPage>[0])
    );
    const clientWhere = vi.mocked(prisma.contact.findMany).mock.calls[0][0]!
      .where;
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
      withTeam as unknown as Awaited<ReturnType<typeof prisma.matter.findUnique>>
    );
    vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([
      { id: "c1", name: "Maria", organization: null, isActive: false },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([
      { id: "u-lead", name: "Dana Lead", jobTitle: "Attorney", isActive: false },
      { id: "u2", name: "Eli Active", jobTitle: "Paralegal", isActive: true },
    ] as never);
    render(
      await EditMatterPage({
        params: Promise.resolve({ id: "m1" }),
      } as Parameters<typeof EditMatterPage>[0])
    );
    expect(formProps.current?.options.clients).toEqual([
      expect.objectContaining({ id: "c1", inactive: true }),
    ]);
    expect(formProps.current?.options.users).toEqual([
      expect.objectContaining({ id: "u-lead", inactive: true }),
      expect.objectContaining({ id: "u2", inactive: false }),
    ]);
    // Team card never offers the departed user.
    expect(teamProps.current?.userOptions.map((u) => u.id)).toEqual(["u2"]);
  });

  test("the lead field is only unlocked with matters.manage_team (F138/F300/F767)", async () => {
    grant("matters.edit");
    await renderPage();
    expect(formProps.current?.canChangeLead).toBe(false);
  });

  test("manage_team unlocks the lead field", async () => {
    grant("matters.edit", "matters.manage_team");
    await renderPage();
    expect(formProps.current?.canChangeLead).toBe(true);
  });
});
