/** Horizontal text alignment buttons. */

"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { ToolButton } from "./tool-button";

export type TextAlign = "left" | "center" | "right";

const ALIGNS: Record<TextAlign, { label: string; icon: typeof AlignLeft }> = {
  left: { label: "Align left", icon: AlignLeft },
  center: { label: "Center", icon: AlignCenter },
  right: { label: "Align right", icon: AlignRight },
};

export function AlignButtons({
  editor,
  values = ["left", "center", "right"],
}: {
  editor: Editor;
  values?: TextAlign[];
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      center: e.isActive({ textAlign: "center" }),
      right: e.isActive({ textAlign: "right" }),
    }),
  });
  return (
    <>
      {values.map((v) => {
        const { label, icon: Icon } = ALIGNS[v];
        return (
          <ToolButton
            key={v}
            label={label}
            // Left is the default, so (as before) it never shows pressed.
            active={v === "left" ? undefined : s?.[v]}
            onClick={() => editor.chain().focus().setTextAlign(v).run()}
          >
            <Icon size={13} />
          </ToolButton>
        );
      })}
    </>
  );
}
