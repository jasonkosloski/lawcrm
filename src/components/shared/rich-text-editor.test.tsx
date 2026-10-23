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

import { describe, expect, test, vi } from "vitest";
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

describe("RichTextEditor — email preset", () => {
  test("adds underline, alignment, link and table controls; notes does not", async () => {
    const { unmount } = render(<RichTextEditor onChange={() => {}} preset="email" />);
    for (const name of ["Underline", "Center", "Align right", "Link", "Table"]) {
      expect(await screen.findByRole("button", { name })).toBeInTheDocument();
    }
    unmount();
    render(<RichTextEditor onChange={() => {}} />);
    await screen.findByRole("button", { name: "Bold" });
    for (const name of ["Underline", "Center", "Link", "Table"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  test("template paragraph styles load; disallowed declarations are dropped on change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        onChange={onChange}
        preset="email"
        initialHTML='<p style="margin-bottom:12pt;color:red;position:absolute">x</p>'
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Quote" }));
    const html = (onChange.mock.lastCall?.[0] as string).replace(/:\s+/g, ":");
    expect(html).toContain("margin-bottom:12pt");
    expect(html).not.toContain("color");
    expect(html).not.toContain("position");
  });
});
