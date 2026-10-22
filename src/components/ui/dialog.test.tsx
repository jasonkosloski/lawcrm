/**
 * Dialog primitives: tall dialogs must stay reachable on short
 * viewports (Base UI scroll-locks the page, so the popup itself has to
 * scroll), and the command palette's sr-only title must live inside the
 * popup, not in every page's DOM while it's closed.
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { CommandDialog } from "./command";

describe("DialogContent", () => {
  test("is height-capped to the viewport and scrolls internally (F396)", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Tall</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const popup = screen.getByRole("dialog");
    expect(popup.className).toContain("max-h-[calc(100dvh-2rem)]");
    expect(popup.className).toContain("overflow-y-auto");
  });
});

describe("CommandDialog", () => {
  test("closed: renders no title/description heading in the page (F986)", () => {
    render(
      <CommandDialog open={false} title="Command palette">
        <div>body</div>
      </CommandDialog>,
    );
    expect(screen.queryByRole("heading", { name: "Command palette" })).toBeNull();
    expect(screen.queryByText("Search for a command to run...")).toBeNull();
  });

  test("open: the sr-only title is inside the dialog popup and labels it", () => {
    render(
      <CommandDialog open title="Command palette">
        <div>body</div>
      </CommandDialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    const heading = screen.getByRole("heading", { name: "Command palette" });
    expect(dialog.contains(heading)).toBe(true);
  });
});
