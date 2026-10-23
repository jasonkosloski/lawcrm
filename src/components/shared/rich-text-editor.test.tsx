/**
 * Tests for the shared Tiptap editor.
 *
 * Regressions pinned:
 *   - the `placeholder` prop never rendered (data-placeholder had no
 *     reader)
 *   - toolbar aria-pressed/active state went stale: Tiptap 3 doesn't
 *     re-render on transactions, so clicking Bold with an empty
 *     selection (a stored mark) left the button un-pressed
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RichTextEditor } from "./rich-text-editor";

describe("RichTextEditor — placeholder", () => {
  test("shows the placeholder while empty", async () => {
    render(<RichTextEditor onChange={() => {}} placeholder="Write your reply…" />);
    expect(await screen.findByText("Write your reply…")).toBeInTheDocument();
  });

  test("hides the placeholder once there is content", async () => {
    render(
      <RichTextEditor
        onChange={() => {}}
        initialHTML="<p>Already typed</p>"
        placeholder="Write your reply…"
      />,
    );
    await screen.findByRole("button", { name: "Bold" });
    expect(screen.queryByText("Write your reply…")).toBeNull();
  });
});

describe("RichTextEditor — toolbar state", () => {
  test("clicking Bold with an empty selection updates aria-pressed without a document change", async () => {
    const user = userEvent.setup();
    render(<RichTextEditor onChange={() => {}} />);
    const bold = await screen.findByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("aria-pressed", "false");

    await user.click(bold);
    expect(bold).toHaveAttribute("aria-pressed", "true");

    await user.click(bold);
    expect(bold).toHaveAttribute("aria-pressed", "false");
  });
});
