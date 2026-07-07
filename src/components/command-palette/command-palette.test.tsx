/**
 * Tests for CommandPalette.
 *
 * The regression worth pinning: the on-open `getPaletteData()` call
 * had no rejection handling. A failed fetch (expired session,
 * network blip, server error) left `data` null forever, so the
 * palette sat on "Loading…" with no retry path until closed and
 * reopened. On failure the palette must fall back to EMPTY data so
 * the static navigation destinations stay usable and a non-matching
 * query reads "No results.", not a perpetual "Loading…".
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/matters",
}));

vi.mock("@/lib/queries/command-palette", () => ({
  getPaletteData: vi.fn(),
}));

vi.mock("@/app/actions/matter-pins", () => ({
  toggleMatterPin: vi.fn(),
}));

import {
  getPaletteData,
  type PaletteData,
} from "@/lib/queries/command-palette";
import { CommandPalette } from "./command-palette";

const mockedFetch = vi.mocked(getPaletteData);

// Radix locks body pointer-events while the dialog is open;
// userEvent's computed-style check trips over that in happy-dom,
// so disable it — the elements are genuinely interactive.
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  mockedFetch.mockReset();
  window.localStorage.clear();
});

describe("CommandPalette — fetch failure on open", () => {
  test("falls back to empty data: nav stays usable, no stuck 'Loading…'", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedFetch.mockRejectedValue(new Error("session expired"));

    render(<CommandPalette open onOpenChange={() => {}} />);
    await waitFor(() => expect(warn).toHaveBeenCalled());

    // Static navigation destinations don't depend on the fetch and
    // must remain selectable after the failure.
    expect(screen.getByText("All matters")).toBeInTheDocument();

    // A non-matching query must read "No results." — the pre-fix
    // behavior was a permanent "Loading…" because `data` stayed null.
    const user = setupUser();
    await user.type(
      screen.getByPlaceholderText(/type to search/i),
      "zzzz-no-such-thing"
    );
    expect(await screen.findByText("No results.")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();

    warn.mockRestore();
  });

  test("successful fetch still populates the palette (fallback isn't unconditional)", async () => {
    const data: PaletteData = {
      items: [
        {
          kind: "matter",
          id: "m1234567890abcdefghij",
          name: "Smith v. Jones",
          caseNumber: "2026-CV-001",
          clientName: "Ann Smith",
          area: "pi",
          stage: "Litigation",
          color: "#336699",
          isPinned: false,
        },
      ],
    };
    mockedFetch.mockResolvedValue(data);

    render(<CommandPalette open onOpenChange={() => {}} />);
    expect(await screen.findByText("Smith v. Jones")).toBeInTheDocument();
  });
});
