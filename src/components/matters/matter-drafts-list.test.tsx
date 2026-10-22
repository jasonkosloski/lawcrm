import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/actions/matter-drafts", () => ({
  deleteMatterDraft: vi.fn(async () => ({ ok: true })),
}));

import { deleteMatterDraft } from "@/app/actions/matter-drafts";
import type { MatterDraftListItem } from "@/lib/queries/matter-drafts";
import { MatterDraftsList } from "./matter-drafts-list";

const drafts: MatterDraftListItem[] = [
  {
    id: "d1",
    clientLabel: "Maria Alvarez",
    practiceAreaName: "Personal Injury",
    updatedAt: new Date("2026-10-19T15:00:00Z"),
    createdByName: "Jason K",
    canDelete: true,
    deletesInDays: 3,
  },
  {
    id: "d2",
    clientLabel: "Untitled draft",
    practiceAreaName: null,
    updatedAt: new Date("2026-10-18T15:00:00Z"),
    createdByName: "Sam P",
    canDelete: false,
    deletesInDays: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  const confirmSpy = vi.fn(() => true);
  vi.stubGlobal("confirm", confirmSpy);
});

describe("MatterDraftsList", () => {
  test("renders nothing with no drafts", () => {
    const { container } = render(<MatterDraftsList drafts={[]} />);
    expect(container.textContent).toBe("");
  });

  test("lists each draft with a Resume link to ?draft=<id> and who started it", () => {
    render(<MatterDraftsList drafts={drafts} timeZone="America/Denver" />);
    expect(screen.getByText("Maria Alvarez")).toBeTruthy();
    expect(screen.getByText(/Started by Jason K/)).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Resume" });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/matters/new?draft=d1",
      "/matters/new?draft=d2",
    ]);
  });

  test("shows the expiry note only when the sweep is near", () => {
    render(<MatterDraftsList drafts={drafts} />);
    expect(screen.getAllByText(/Deletes in/)).toHaveLength(1);
    expect(screen.getByText("Deletes in 3 days")).toBeTruthy();
  });

  test("Delete only for drafts the user can delete", () => {
    render(<MatterDraftsList drafts={drafts} />);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
  });

  test("Delete asks in the app dialog (never window.confirm), then deletes", async () => {
    const user = userEvent.setup();
    render(<MatterDraftsList drafts={drafts} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete this draft?")).toBeTruthy();
    expect(deleteMatterDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete draft" }));
    await waitFor(() => expect(deleteMatterDraft).toHaveBeenCalledWith("d1"));
    expect(window.confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  test("Cancel in the dialog deletes nothing", async () => {
    const user = userEvent.setup();
    render(<MatterDraftsList drafts={drafts} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(deleteMatterDraft).not.toHaveBeenCalled();
  });

  test("deleting the draft that is open returns to a blank form", async () => {
    const user = userEvent.setup();
    render(<MatterDraftsList drafts={drafts} openDraftId="d1" />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Delete draft" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/matters/new"));
  });

  test("a refused delete shows the reason and stays open", async () => {
    vi.mocked(deleteMatterDraft).mockResolvedValueOnce({
      ok: false,
      error: "Only the person who started this draft can delete it.",
    });
    const user = userEvent.setup();
    render(<MatterDraftsList drafts={drafts} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Delete draft" }));
    expect(
      await screen.findByText("Only the person who started this draft can delete it."),
    ).toBeTruthy();
  });
});
