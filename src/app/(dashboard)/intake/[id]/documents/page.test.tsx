/**
 * /intake/[id]/documents — renders the shared browser with a lead
 * scope; a converted lead is read-only with a pointer to the matter's
 * documents.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { lead: { findUnique: vi.fn() } },
}));
vi.mock("@/components/documents/documents-browser", () => ({
  DocumentsBrowser: (props: {
    scope: unknown;
    folderParam: string | null;
    writable?: boolean;
  }) => (
    <div
      data-testid="browser"
      data-scope={JSON.stringify(props.scope)}
      data-folder={String(props.folderParam)}
      data-writable={String(props.writable)}
    />
  ),
}));

import { prisma } from "@/lib/prisma";
import LeadDocumentsPage from "./page";

const lead = (stage: string, convertedMatterId: string | null = null) =>
  vi
    .mocked(prisma.lead.findUnique)
    .mockResolvedValue({ stage, convertedMatterId } as never);

const renderPage = async (sp: Record<string, string> = {}) => {
  const ui = await LeadDocumentsPage({
    params: Promise.resolve({ id: "lead_1" }),
    searchParams: Promise.resolve(sp),
  } as Parameters<typeof LeadDocumentsPage>[0]);
  return render(ui ?? <></>);
};

afterEach(() => vi.clearAllMocks());

describe("LeadDocumentsPage", () => {
  test("open lead: browser gets the lead scope, folder param and is writable", async () => {
    lead("qualifying");
    await renderPage({ folder: "f1" });
    const b = screen.getByTestId("browser");
    expect(JSON.parse(b.getAttribute("data-scope")!)).toEqual({
      kind: "lead",
      leadId: "lead_1",
    });
    expect(b.getAttribute("data-folder")).toBe("f1");
    expect(b.getAttribute("data-writable")).toBe("true");
    expect(screen.queryByRole("link", { name: /matter documents/i })).toBeNull();
  });

  test("converted lead: read-only browser + banner linking to the matter's documents", async () => {
    lead("converted", "m_9");
    await renderPage();
    expect(screen.getByTestId("browser").getAttribute("data-writable")).toBe(
      "false"
    );
    expect(
      screen.getByRole("link", { name: /open matter documents/i })
    ).toHaveAttribute("href", "/matters/m_9/documents");
  });
});
