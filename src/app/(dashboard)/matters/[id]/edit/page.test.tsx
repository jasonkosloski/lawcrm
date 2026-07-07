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
vi.mock("@/components/matters/edit-matter-form", () => ({
  EditMatterForm: () => <div data-testid="edit-matter-form" />,
}));
vi.mock("@/components/matters/matter-team-management", () => ({
  MatterTeamManagement: () => <div data-testid="team-management" />,
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
