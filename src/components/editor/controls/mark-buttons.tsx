/** Text-mark toggles (bold, italic, ...) for any editor toolbar. */

"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { Bold, Code, Italic, Strikethrough, Underline } from "lucide-react";
import type { ReactNode } from "react";
import { ToolButton } from "./tool-button";

export type MarkKind =
  "bold" | "italic" | "underline" | "strike" | "code" | "smallCaps" | "allCaps";

const MARKS: Record<MarkKind, { label: string; icon: ReactNode; toggle: (e: Editor) => void }> = {
  bold: {
    label: "Bold",
    icon: <Bold size={13} />,
    toggle: (e) => e.chain().focus().toggleBold().run(),
  },
  italic: {
    label: "Italic",
    icon: <Italic size={13} />,
    toggle: (e) => e.chain().focus().toggleItalic().run(),
  },
  underline: {
    label: "Underline",
    icon: <Underline size={13} />,
    toggle: (e) => e.chain().focus().toggleUnderline().run(),
  },
  strike: {
    label: "Strikethrough",
    icon: <Strikethrough size={13} />,
    toggle: (e) => e.chain().focus().toggleStrike().run(),
  },
  code: {
    label: "Inline code",
    icon: <Code size={13} />,
    toggle: (e) => e.chain().focus().toggleCode().run(),
  },
  smallCaps: {
    label: "Small caps",
    icon: <span className="text-xs font-semibold [font-variant:small-caps]">Sc</span>,
    toggle: (e) => e.chain().focus().toggleSmallCaps().run(),
  },
  allCaps: {
    label: "All caps",
    icon: <span className="text-xs font-semibold">AA</span>,
    toggle: (e) => e.chain().focus().toggleAllCaps().run(),
  },
};

/** One toggle button per requested mark, in the order given. */
export function MarkButtons({ editor, marks }: { editor: Editor; marks: MarkKind[] }) {
  // Tiptap 3 does not re-render on transactions; subscribe to the active flags.
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      Object.fromEntries(marks.map((m) => [m, e.isActive(m)])) as Record<string, boolean>,
  });
  return (
    <>
      {marks.map((m) => (
        <ToolButton
          key={m}
          label={MARKS[m].label}
          active={active?.[m]}
          onClick={() => MARKS[m].toggle(editor)}
        >
          {MARKS[m].icon}
        </ToolButton>
      ))}
    </>
  );
}
