/**
 * The lazy wrapper must hand its props through to the real editor once
 * the chunk arrives. The real Tiptap editor is stubbed (happy-dom lacks
 * the contenteditable / Selection APIs it needs).
 */
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/shared/rich-text-editor", () => ({
  RichTextEditor: ({ placeholder }: { placeholder?: string }) => (
    <textarea aria-label="editor" placeholder={placeholder} />
  ),
}));

import { RichTextEditor } from "./rich-text-editor-lazy";

describe("lazy RichTextEditor", () => {
  test("renders the real editor with the caller's props", async () => {
    render(<RichTextEditor onChange={() => {}} placeholder="Write…" />);
    const editor = await screen.findByLabelText("editor");
    expect(editor.getAttribute("placeholder")).toBe("Write…");
  });
});
