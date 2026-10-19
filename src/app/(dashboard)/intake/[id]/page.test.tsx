/**
 * Lead Overview page: the live conflict matcher runs for OPEN leads
 * only (a converted / declined lead drives no further decision), and a
 * closed lead offers no re-run / override.
 */

import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Lead wall (ADR-049) is unit-tested in src/lib/lead-access.test.ts;
// pages are pinned to call it by src/app/page-guards.test.ts.
vi.mock("@/lib/lead-access", () => ({
  assertLeadAccess: vi.fn(async () => "u1"),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(),
  getCurrentUserId: vi.fn(async () => "u1"),
}));
vi.mock("@/lib/conflict-check-redact", () => ({
  redactConflictResultForViewer: vi.fn(async (_u: string, r: unknown) => r),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(async () => true),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(async () => [{ id: "u2", name: "Bob", jobTitle: null }]),
    },
  },
}));
vi.mock("@/lib/conflict-check", () => ({
  runConflictMatcher: vi.fn(async () => ({ severity: "clear", matches: [] })),
}));
vi.mock("@/lib/queries/leads", () => ({
  getLeadById: vi.fn(),
  LEAD_SOURCE_LABEL: {},
}));

import { runConflictMatcher } from "@/lib/conflict-check";
import { getLeadById } from "@/lib/queries/leads";
import { ConflictCheckCard } from "@/components/intake/conflict-check-card";
import { LeadAccessCard } from "@/components/intake/lead-access-card";
import { currentUserHasPermission } from "@/lib/permission-check";
import LeadOverviewPage from "./page";

const mockedMatcher = vi.mocked(runConflictMatcher);
const mockedLead = vi.mocked(getLeadById);

function findAll(node: ReactNode, type: unknown, out: unknown[] = []) {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, out));
  else if (isValidElement(node)) {
    if (node.type === type) out.push(node);
    findAll((node.props as { children?: ReactNode }).children, type, out);
  }
  return out;
}

function lead(stage: string, extra: Record<string, unknown> = {}) {
  return {
    id: "lead1",
    stage,
    restricted: false,
    teamMembers: [],
    name: "Priya Patel",
    contactId: "c1",
    contact: { id: "c1", name: "Priya Patel", email: "p@x.com", organization: null, phones: [] },
    email: null,
    summary: null,
    location: null,
    // Date-only value stored at UTC midnight.
    dateOfIncident: new Date("2026-04-15T00:00:00.000Z"),
    injuries: null,
    priorCounsel: false,
    liabilityAssessment: null,
    damagesAssessment: null,
    defendantAbility: null,
    declineReason: null,
    convertedMatter: null,
    source: null,
    sourceDetail: null,
    statuteWindow: 100,
    statuteDaysRemaining: 20,
    createdAt: new Date("2026-04-01T12:00:00Z"),
    conflictCheck: "warn",
    conflictCheckedAt: null,
    conflictResolutionNotes: null,
    displayName: "Priya Patel",
    displayEmail: "p@x.com",
    displayPhone: null,
    ...extra,
  } as unknown as Awaited<ReturnType<typeof getLeadById>>;
}

async function renderPage(stage: string, extra: Record<string, unknown> = {}) {
  mockedLead.mockResolvedValue(lead(stage, extra));
  const tree = await LeadOverviewPage({
    params: Promise.resolve({ id: "lead1" }),
  } as unknown as Parameters<typeof LeadOverviewPage>[0]);
  const [card] = findAll(tree, ConflictCheckCard) as Array<{
    props: Record<string, unknown>;
  }>;
  return { tree, card };
}

beforeEach(() => {
  mockedMatcher.mockClear();
});

describe("LeadOverviewPage conflict card", () => {
  test("an open lead runs the live matcher and offers run/override", async () => {
    const { card } = await renderPage("qualifying");
    expect(mockedMatcher).toHaveBeenCalledTimes(1);
    expect(mockedMatcher).toHaveBeenCalledWith(
      expect.objectContaining({ ownContactId: "c1" })
    );
    expect(card.props).toMatchObject({
      canRun: true,
      canOverride: true,
      matchesNotLive: false,
    });
  });

  test.each(["converted", "declined"])(
    "a %s lead skips the matcher and offers no run/override",
    async (stage) => {
      const { card } = await renderPage(stage);
      expect(mockedMatcher).not.toHaveBeenCalled();
      expect(card.props).toMatchObject({
        canRun: false,
        canOverride: false,
        matchesNotLive: true,
        matches: [],
        status: "warn",
      });
    }
  );
});

describe("LeadOverviewPage access card (ADR-049)", () => {
  const accessCard = async (extra: Record<string, unknown>) => {
    const { tree } = await renderPage("qualifying", extra);
    return (findAll(tree, LeadAccessCard) as Array<{ props: Record<string, unknown> }>)[0];
  };

  test("intake.restrict holders get a managing card with the user picker", async () => {
    const card = await accessCard({});
    expect(card.props).toMatchObject({
      leadId: "lead1",
      restricted: false,
      canManage: true,
      userOptions: [{ id: "u2", name: "Bob", jobTitle: null }],
    });
  });

  test("a restricted lead lists its team read-only for viewers without the key", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key: string) => key !== "intake.restrict"
    );
    const card = await accessCard({
      restricted: true,
      teamMembers: [
        { userId: "u1", role: "lead", user: { name: "Alice", initials: "AL", jobTitle: null } },
      ],
    });
    expect(card.props).toMatchObject({
      restricted: true,
      canManage: false,
      userOptions: [],
      members: [{ userId: "u1", role: "lead", name: "Alice", initials: "AL", jobTitle: null }],
    });
    vi.mocked(currentUserHasPermission).mockImplementation(async () => true);
  });

  test("an open lead shows no card to viewers without the key", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key: string) => key !== "intake.restrict"
    );
    expect(await accessCard({})).toBeUndefined();
    vi.mocked(currentUserHasPermission).mockImplementation(async () => true);
  });
});
