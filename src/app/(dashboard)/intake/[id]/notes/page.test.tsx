/**
 * /intake/[id]/notes — composer gating and the converted-lead state.
 *
 * Mirrors the matter Notes tab: the composer renders only for viewers
 * holding `notes.create` (a refused save redirects and loses the typed
 * note), its pin toggle follows `notes.pin`, and it offers no capture
 * kinds (those need a matter). A converted lead shows a pointer to the
 * matter's notes instead of a composer.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { NoteScope } from "@/lib/note-scope";
import type { NoteAccess } from "@/lib/note-constants";

// Lead wall (ADR-049) is unit-tested in src/lib/lead-access.test.ts;
// pages are pinned to call it by src/app/page-guards.test.ts.
vi.mock("@/lib/lead-access", () => ({
  assertLeadAccess: vi.fn(async () => "u1"),
}));
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
  getCurrentUserId: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/permission-check", () => ({
  getCurrentUserPermissions: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { lead: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/queries/matter-detail", () => ({
  getLeadNotes: vi.fn(async () => []),
}));
vi.mock("@/components/matters/notes/note-composer", () => ({
  NoteComposer: ({
    canPin,
    allowedKinds,
    scope,
  }: {
    canPin: boolean;
    allowedKinds: string[];
    scope: NoteScope;
  }) => (
    <div
      data-testid="note-composer"
      data-can-pin={String(canPin)}
      data-kinds={allowedKinds.join(",")}
      data-scope={JSON.stringify(scope)}
    />
  ),
}));
vi.mock("@/components/matters/notes/notes-tab-body", () => ({
  NotesTabBody: ({ access }: { access: NoteAccess }) => (
    <div data-testid="notes-body" data-can-create={String(access.canCreateNote)} />
  ),
}));

import { getCurrentUserPermissions } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { getLeadNotes } from "@/lib/queries/matter-detail";
import { assertLeadAccess } from "@/lib/lead-access";
import LeadNotesPage from "./page";

const mockedFindLead = vi.mocked(prisma.lead.findUnique);

const grant = (keys: string[]) =>
  vi.mocked(getCurrentUserPermissions).mockResolvedValue({
    isAdmin: false,
    granted: new Set(keys),
  } as Awaited<ReturnType<typeof getCurrentUserPermissions>>);

const lead = (stage: string, convertedMatterId: string | null = null) =>
  mockedFindLead.mockResolvedValue({ stage, convertedMatterId } as never);

const renderPage = async () => {
  const ui = await LeadNotesPage({
    params: Promise.resolve({ id: "lead_1" }),
  } as Parameters<typeof LeadNotesPage>[0]);
  return render(ui ?? <></>);
};

afterEach(() => vi.clearAllMocks());

describe("LeadNotesPage", () => {
  test("a restricted lead the viewer isn't on 404s before any read (ADR-049)", async () => {
    vi.mocked(assertLeadAccess).mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockedFindLead).not.toHaveBeenCalled();
    expect(getLeadNotes).not.toHaveBeenCalled();
  });

  test("open lead + notes.create + notes.pin: lead-scoped composer, pin, no captures", async () => {
    lead("qualifying");
    grant(["notes.create", "notes.pin"]);
    await renderPage();
    const composer = screen.getByTestId("note-composer");
    expect(composer.getAttribute("data-can-pin")).toBe("true");
    expect(composer.getAttribute("data-kinds")).toBe("");
    expect(JSON.parse(composer.getAttribute("data-scope")!)).toEqual({
      kind: "lead",
      leadId: "lead_1",
    });
    expect(getLeadNotes).toHaveBeenCalledWith("lead_1");
  });

  test("no notes.create: no composer, notes still list", async () => {
    lead("new");
    grant(["notes.pin"]);
    await renderPage();
    expect(screen.queryByTestId("note-composer")).toBeNull();
    expect(screen.getByTestId("notes-body")).toBeTruthy();
  });

  test("converted lead: pointer to the matter's notes, no composer or replies", async () => {
    lead("converted", "m_9");
    grant(["notes.create"]);
    await renderPage();
    expect(screen.queryByTestId("note-composer")).toBeNull();
    expect(screen.getByRole("link", { name: /open matter notes/i }).getAttribute("href")).toBe(
      "/matters/m_9/notes",
    );
    expect(screen.getByTestId("notes-body").getAttribute("data-can-create")).toBe("false");
  });
});
