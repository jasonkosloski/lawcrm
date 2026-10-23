import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EDITOR_CONTENT_CLASS, EditorShell } from "./editor-shell";
import { BODY_CLASS } from "@/components/templates/editor/use-body-editor";
import { RichTextEditor } from "@/components/shared/rich-text-editor";

function Harness({ readOnly, content = "" }: { readOnly?: boolean; content?: string }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content,
    immediatelyRender: false,
  });
  if (!editor) return null;
  return (
    <EditorShell
      editor={editor}
      label="Test body"
      placeholder="Type here"
      readOnly={readOnly}
      toolbar={<div data-testid="toolbar" />}
    />
  );
}

describe("EDITOR_CONTENT_CLASS", () => {
  test("draws list markers", () => {
    expect(EDITOR_CONTENT_CLASS).toContain("[&_ul]:list-disc");
    expect(EDITOR_CONTENT_CLASS).toContain("[&_ol]:list-decimal");
  });

  test("BODY_CLASS composes it", () => {
    expect(BODY_CLASS).toContain("[&_ul]:list-disc");
    expect(BODY_CLASS).toContain("[&_ol]:list-decimal");
  });
});

describe("EditorShell", () => {
  test("shows the placeholder while empty and the toolbar when editable", async () => {
    render(<Harness />);
    expect(await screen.findByText("Type here")).toBeInTheDocument();
    expect(screen.getByTestId("toolbar")).toBeInTheDocument();
  });

  test("hides the placeholder with content", async () => {
    render(<Harness content="<p>hi</p>" />);
    expect(await screen.findByRole("group", { name: "Test body" })).toBeInTheDocument();
    expect(screen.queryByText("Type here")).toBeNull();
  });

  test("read-only renders no toolbar slot and no placeholder", async () => {
    render(<Harness readOnly />);
    expect(await screen.findByRole("group", { name: "Test body" })).toBeInTheDocument();
    expect(screen.queryByTestId("toolbar")).toBeNull();
    expect(screen.queryByText("Type here")).toBeNull();
  });
});

describe("RichTextEditor content classes", () => {
  test("content element carries the list marker classes", async () => {
    const { container } = render(<RichTextEditor onChange={() => {}} />);
    await screen.findByRole("button", { name: "Bold" });
    const pm = container.querySelector(".ProseMirror");
    expect(pm?.className).toContain("[&_ul]:list-disc");
    expect(pm?.className).toContain("[&_ol]:list-decimal");
  });
});
