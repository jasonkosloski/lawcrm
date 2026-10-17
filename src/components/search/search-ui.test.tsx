/**
 * UI regressions for the /search components:
 *  - a hit with no destination (firm-wide task) renders unlinked,
 *  - the Save button survives a rejected server action (an uncaught
 *    rejection in a transition would reach the error boundary and
 *    replace the whole page).
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/saved-searches", () => ({
  createSavedSearch: vi.fn(),
  deleteSavedSearch: vi.fn(),
  renameSavedSearch: vi.fn(),
}));

import { createSavedSearch } from "@/app/actions/saved-searches";
import { SaveSearchButton } from "./save-search-button";
import { SearchResults } from "./search-results";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SearchResults — empty states", () => {
  test("an expanded type with no hits names the type and links to all types", () => {
    render(
      <SearchResults
        expandedType="note"
        result={{ query: "zebra", groups: [] }}
      />
    );
    expect(screen.getByText(/No notes results for/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /Search all types/ });
    expect(link.getAttribute("href")).toBe("/search?q=zebra");
  });

  test("no expanded type shows the generic empty state", () => {
    render(
      <SearchResults expandedType={null} result={{ query: "zebra", groups: [] }} />
    );
    expect(screen.getByText(/No results for/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("SearchResults", () => {
  test("a hit without an href renders as plain text, not a link", () => {
    render(
      <SearchResults
        expandedType={null}
        result={{
          query: "ambulance",
          groups: [
            {
              type: "task",
              total: 2,
              hits: [
                {
                  type: "task",
                  id: "t1",
                  title: "Order ambulance mugs",
                  snippet: null,
                  href: null,
                  context: "Firm-wide",
                },
                {
                  type: "task",
                  id: "t2",
                  title: "Subpoena ambulance records",
                  snippet: null,
                  href: "/matters/m1/tasks",
                  context: "Matter",
                },
              ],
            },
          ],
        }}
      />
    );
    expect(
      screen.queryByRole("link", { name: /order ambulance mugs/i })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Order ambulance mugs")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /subpoena ambulance records/i })
    ).toHaveAttribute("href", "/matters/m1/tasks");
  });
});

describe("SaveSearchButton", () => {
  test("a rejected action alerts instead of throwing into the error boundary", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createSavedSearch).mockRejectedValue(new Error("db down"));

    render(<SaveSearchButton query="ambulance" type={null} savedId={null} />);
    await userEvent.setup().click(screen.getByRole("button"));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(createSavedSearch).toHaveBeenCalledWith(
      "ambulance",
      "ambulance",
      null
    );
  });

  test("a validation error from the action is shown", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    vi.mocked(createSavedSearch).mockResolvedValue({
      ok: false,
      error: "nope",
    });
    render(<SaveSearchButton query="ambulance" type={null} savedId={null} />);
    await userEvent.setup().click(screen.getByRole("button"));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("nope"));
  });
});
