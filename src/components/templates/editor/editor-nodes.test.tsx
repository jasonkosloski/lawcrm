/**
 * Node views render in a real (happy-dom) editor: chips, rule headers,
 * the block preview and the unknown-path error style.
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { fieldByPath } from "@/lib/templates/catalog";
import type { BlockSource } from "@/lib/templates/render";
import { createTemplateExtensions } from "./extensions";

const para = (...content: unknown[]) => ({
  type: "paragraph",
  attrs: { textAlign: null },
  content,
});
const text = (t: string) => ({ type: "text" as const, text: t });

const BLOCK: BlockSource = {
  id: "b1",
  name: "Sign-off",
  isActive: true,
  content: { type: "doc", content: [{ type: "paragraph", content: [text("Sincerely yours")] }] },
};

function Harness({ content, blocks = [] }: { content: unknown; blocks?: BlockSource[] }) {
  const editor = useEditor({
    extensions: createTemplateExtensions({ kind: "letter", isBlock: false, blocks }),
    content: content as never,
    immediatelyRender: true,
  });
  return <EditorContent editor={editor} />;
}

const DOC = {
  type: "doc",
  content: [
    para(
      { type: "field", attrs: { path: "client.name", format: "full" } },
      { type: "field", attrs: { path: "bogus.path", format: null } },
    ),
    { type: "block", attrs: { blockId: "b1" } },
    { type: "block", attrs: { blockId: "gone" } },
    {
      type: "showIf",
      attrs: { path: "matter.name", op: "in", values: ["a", "b"] },
      content: [para(text("inside"))],
    },
    {
      type: "repeat",
      attrs: { list: "parties.clients" },
      content: [
        para({ type: "field", attrs: { path: "item.name", format: null } }),
        { type: "repeatEmpty", content: [para(text("nobody"))] },
      ],
    },
  ],
};

describe("template node views", () => {
  it("renders chips, headers and block previews", async () => {
    const { container } = render(<Harness content={DOC} blocks={[BLOCK]} />);
    await waitFor(() => expect(container.querySelector("[data-field-chip]")).not.toBeNull());

    const chips = [...container.querySelectorAll("[data-field-chip]")];
    expect(chips[0].textContent).toBe(`${fieldByPath("client.name")!.label} · Full name`);
    expect(chips[1].textContent).toBe("bogus.path");
    expect(chips[1].getAttribute("data-invalid")).not.toBeNull();
    // Inside a repeat, item.* resolves against the list's item fields.
    expect(chips[2].getAttribute("data-invalid")).toBeNull();
    expect(chips[2].textContent).not.toContain("item.");

    expect(screen.getByText(/^Show if: .+ is one of a, b$/)).toBeTruthy();
    expect(screen.getByText(/^Repeat for each: /)).toBeTruthy();
    expect(screen.getByText("If none:")).toBeTruthy();

    expect(screen.getByText("Block: Sign-off")).toBeTruthy();
    expect(container.textContent).toContain("Sincerely yours");
    expect(screen.getByText("Missing block")).toBeTruthy();
  });
});
