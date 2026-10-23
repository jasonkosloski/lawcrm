/** Bulleted / numbered list toggles. */

"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { List, ListOrdered } from "lucide-react";
import { ToolButton } from "./tool-button";

export function ListButtons({
  editor,
  bulletLabel = "Bulleted list",
}: {
  editor: Editor;
  /** The bullet button's accessible name (the notes toolbar says "Bullet list"). */
  bulletLabel?: string;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
    }),
  });
  return (
    <>
      <ToolButton
        label={bulletLabel}
        active={s?.bullet}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={13} />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={s?.ordered}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={13} />
      </ToolButton>
    </>
  );
}
