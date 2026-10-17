/**
 * Matter Notes tab — composer gating.
 *
 * The note-create action redirects a denied user to "/", which would
 * discard a long note they had typed. So the composer is only
 * rendered for viewers holding `notes.create`, and its pin toggle
 * only reflects `notes.pin`.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
  getCurrentUserId: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/permission-check", () => ({
  getCurrentUserPermissions: vi.fn(),
}));
vi.mock("@/lib/queries/matter-detail", () => ({
  getMatterNotes: vi.fn(async () => []),
}));
vi.mock("@/components/matters/notes/note-composer", () => ({
  NoteComposer: ({ canPin }: { canPin: boolean }) => (
    <div data-testid="note-composer" data-can-pin={String(canPin)} />
  ),
}));
vi.mock("@/components/matters/notes/notes-tab-body", () => ({
  NotesTabBody: () => <div data-testid="notes-body" />,
}));

import { getCurrentUserPermissions } from "@/lib/permission-check";
import MatterNotesPage from "./page";

const grant = (keys: string[]) =>
  vi.mocked(getCurrentUserPermissions).mockResolvedValue({
    isAdmin: false,
    granted: new Set(keys),
  } as Awaited<ReturnType<typeof getCurrentUserPermissions>>);

const renderPage = async () =>
  render(
    await MatterNotesPage({
      params: Promise.resolve({ id: "m1" }),
    } as Parameters<typeof MatterNotesPage>[0])
  );

afterEach(() => vi.clearAllMocks());

describe("MatterNotesPage", () => {
  test("notes.create + notes.pin: composer with the pin toggle", async () => {
    grant(["notes.create", "notes.pin"]);
    await renderPage();
    expect(
      screen.getByTestId("note-composer").getAttribute("data-can-pin")
    ).toBe("true");
  });

  test("notes.create without notes.pin: composer, no pin", async () => {
    grant(["notes.create"]);
    await renderPage();
    expect(
      screen.getByTestId("note-composer").getAttribute("data-can-pin")
    ).toBe("false");
  });

  test("no notes.create: no composer, but the notes still list", async () => {
    grant(["notes.pin"]);
    await renderPage();
    expect(screen.queryByTestId("note-composer")).toBeNull();
    expect(screen.getByTestId("notes-body")).toBeTruthy();
  });
});
