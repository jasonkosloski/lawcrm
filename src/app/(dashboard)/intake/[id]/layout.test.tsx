/**
 * The lead layout only offers Decline / Convert to viewers whose role
 * can actually use them (intake.decline / matters.create) — the server
 * actions would otherwise bounce the click to "/" after the user has
 * typed into the dialog.
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
vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/queries/leads", () => ({
  getLeadById: vi.fn(),
  LEAD_STAGE_LABEL: { new: "New" },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: { findMany: vi.fn(async () => []) },
    user: {
      findUnique: vi.fn(async () => ({ firm: { requireOriginatingDoc: false } })),
    },
  },
}));
vi.mock("@/app/actions/billing/helpers", () => ({
  todayDateOnly: vi.fn(async () => new Date("2026-10-20T00:00:00Z")),
}));
vi.mock("@/lib/queries/practice-area-options", () => ({
  getPracticeAreaOptions: vi.fn(async () => []),
}));

import { currentUserHasPermission } from "@/lib/permission-check";
import { getLeadById } from "@/lib/queries/leads";
import { ConvertLeadButton } from "@/components/intake/convert-lead-button";
import { DeclineLeadButton } from "@/components/intake/decline-lead-button";
import { TopBar } from "@/components/layout/topbar";
import LeadDetailLayout from "./layout";

const mockedHas = vi.mocked(currentUserHasPermission);
const mockedLead = vi.mocked(getLeadById);

/** Depth-first search of a React element tree for a component type. */
function findAll(node: ReactNode, type: unknown, out: unknown[] = []) {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, out));
  else if (isValidElement(node)) {
    if (node.type === type) out.push(node);
    findAll((node.props as { children?: ReactNode }).children, type, out);
  }
  return out;
}

async function renderLayout(opts: {
  grants: string[];
  stage?: string;
}): Promise<{ decline: number; convert: number }> {
  mockedHas.mockImplementation(async (key) => opts.grants.includes(key));
  mockedLead.mockResolvedValue({
    id: "lead1",
    stage: opts.stage ?? "new",
    score: null,
    displayName: "Priya Patel",
    convertedMatter: null,
  } as unknown as Awaited<ReturnType<typeof getLeadById>>);
  const tree = await LeadDetailLayout({
    children: null,
    params: Promise.resolve({ id: "lead1" }),
  } as unknown as Parameters<typeof LeadDetailLayout>[0]);
  const [topBar] = findAll(tree, TopBar) as Array<{
    props: { actions?: ReactNode };
  }>;
  const actions = topBar.props.actions;
  return {
    decline: findAll(actions, DeclineLeadButton).length,
    convert: findAll(actions, ConvertLeadButton).length,
  };
}

beforeEach(() => {
  mockedHas.mockReset();
  mockedLead.mockReset();
});

describe("LeadDetailLayout action buttons", () => {
  test("a role with neither permission sees neither button", async () => {
    expect(await renderLayout({ grants: [] })).toEqual({ decline: 0, convert: 0 });
  });

  test("intake.decline alone shows Decline only", async () => {
    expect(await renderLayout({ grants: ["intake.decline"] })).toEqual({
      decline: 1,
      convert: 0,
    });
  });

  test("matters.create alone shows Convert only", async () => {
    expect(await renderLayout({ grants: ["matters.create"] })).toEqual({
      decline: 0,
      convert: 1,
    });
  });

  test("both permissions show both buttons", async () => {
    expect(
      await renderLayout({ grants: ["intake.decline", "matters.create"] })
    ).toEqual({ decline: 1, convert: 1 });
  });

  test("a resolved lead shows neither, whatever the role", async () => {
    expect(
      await renderLayout({
        grants: ["intake.decline", "matters.create"],
        stage: "declined",
      })
    ).toEqual({ decline: 0, convert: 0 });
  });
});
