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

    // A non-matching query must not strand the palette on
    // "Loading…" (the pre-fix behavior, because `data` stayed null).
    // Since the "Search everywhere" row shipped, a ≥2-char query
    // always has that row visible, so cmdk's empty state ("No
    // results.") no longer renders — assert the escape-hatch row
    // instead, plus the absence of the stuck loading state.
    const user = setupUser();
    await user.type(
      screen.getByPlaceholderText(/type to search/i),
      "zzzz-no-such-thing"
    );
    expect(
      await screen.findByText(/search everywhere for/i)
    ).toBeInTheDocument();
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

describe("CommandPalette — 'Search everywhere' row", () => {
  beforeEach(() => {
    mockedFetch.mockResolvedValue({ items: [] });
    push.mockReset();
  });

  test("hidden while the query is under the 2-char minimum", async () => {
    render(<CommandPalette open onOpenChange={() => {}} />);
    // Empty query → no row.
    expect(screen.queryByText(/search everywhere/i)).not.toBeInTheDocument();
    const user = setupUser();
    await user.type(screen.getByPlaceholderText(/type to search/i), "a");
    expect(screen.queryByText(/search everywhere/i)).not.toBeInTheDocument();
  });

  test("selecting the row routes to /search with the query URL-encoded, and closes", async () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} />);
    const user = setupUser();
    await user.type(
      screen.getByPlaceholderText(/type to search/i),
      "ambulance report"
    );
    const row = await screen.findByText(/search everywhere for/i);
    await user.click(row);
    expect(push).toHaveBeenCalledWith("/search?q=ambulance%20report");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("coexists with jump-to matches instead of replacing them", async () => {
    mockedFetch.mockResolvedValue({
      items: [
        {
          kind: "matter",
          id: "m1234567890abcdefghij",
          name: "Ambulance v. City",
          caseNumber: null,
          clientName: null,
          area: "pi",
          stage: "Litigation",
          color: "#336699",
          isPinned: false,
        },
      ],
    });
    render(<CommandPalette open onOpenChange={() => {}} />);
    const user = setupUser();
    await user.type(
      screen.getByPlaceholderText(/type to search/i),
      "ambulance"
    );
    // Both the preloaded matter hit AND the full-text escape hatch.
    expect(await screen.findByText("Ambulance v. City")).toBeInTheDocument();
    expect(screen.getByText(/search everywhere for/i)).toBeInTheDocument();
  });
});
