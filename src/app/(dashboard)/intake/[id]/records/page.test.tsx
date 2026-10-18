/**
 * Intake Records page: records.view gate; a converted lead shows the
 * banner to the matter's Records tab and the tab goes read-only.
 */

import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

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
const findUnique = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prisma: { lead: { findUnique } },
}));
vi.mock("@/components/records-requests/records-tab", () => ({
  RecordsTab: () => null,
}));

import { currentUserHasPermission } from "@/lib/permission-check";
import { RecordsTab } from "@/components/records-requests/records-tab";
import LeadRecordsPage from "./page";

const has = vi.mocked(currentUserHasPermission);

const call = () =>
  LeadRecordsPage({ params: Promise.resolve({ id: "l1" }) } as never);

function findAll(node: ReactNode, type: unknown, out: unknown[] = []) {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, out));
  else if (isValidElement(node)) {
    if (node.type === type) out.push(node);
    findAll((node.props as { children?: ReactNode }).children, type, out);
  }
  return out;
}
function hrefs(node: ReactNode, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => hrefs(n, out));
  else if (isValidElement(node)) {
    const p = node.props as { href?: string; children?: ReactNode };
    if (typeof p.href === "string") out.push(p.href);
    hrefs(p.children, out);
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  has.mockResolvedValue(true);
});

describe("LeadRecordsPage", () => {
  test("404s without records.view", async () => {
    has.mockResolvedValue(false);
    findUnique.mockResolvedValue({ stage: "new", convertedMatterId: null });
    await expect(call()).rejects.toThrow("NOT_FOUND");
  });

  test("an open lead gets a writable tab on the lead scope", async () => {
    findUnique.mockResolvedValue({ stage: "new", convertedMatterId: null });
    const el = await call();
    const tabs = findAll(el, RecordsTab) as React.ReactElement<Record<string, unknown>>[];
    expect(tabs).toHaveLength(1);
    expect(tabs[0].props).toMatchObject({
      scope: { kind: "lead", leadId: "l1" },
      writable: true,
    });
    expect(hrefs(el)).toEqual([]);
  });

  test("a converted lead shows the banner and goes read-only", async () => {
    findUnique.mockResolvedValue({ stage: "converted", convertedMatterId: "m_9" });
    const el = await call();
    expect(hrefs(el)).toContain("/matters/m_9/records");
    const tabs = findAll(el, RecordsTab) as React.ReactElement<Record<string, unknown>>[];
    expect(tabs[0].props.writable).toBe(false);
  });
});
