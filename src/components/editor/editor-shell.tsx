/**
 * The one editor wrapper: renders a TipTap editor's content with the
 * shared content CSS, an aria label, a placeholder overlay and
 * read-only handling. Surfaces own the editor (extensions, toolbar);
 * the shell owns how it looks and reads.
 */

"use client";

import { useEffect, type ReactNode } from "react";
import { EditorContent, useEditorState, type Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";

/**
 * Content rules every editor surface shares. `prose` is inert (the
 * typography plugin isn't installed) and Tailwind's reset hides list
 * markers, so lists, quotes, code and basic table borders are drawn here.
 * Document-specific rules (table width/resize, paragraph styles) stay with
 * the template editor's `BODY_CLASS`, which composes this.
 */
export const EDITOR_CONTENT_CLASS = cn(
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-[2em] [&_ol]:pl-[2em] [&_ul]:my-0 [&_ol]:my-0",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-3 [&_blockquote]:italic",
  "[&_code]:bg-paper-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_code]:font-mono",
  "[&_pre]:bg-paper-2 [&_pre]:p-2 [&_pre]:rounded [&_pre]:text-[11px]",
  "[&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:p-1 [&_th]:border [&_th]:border-line [&_th]:p-1",
  "[&_p:empty]:min-h-[1em]",
);

export function EditorShell({
  editor,
  className,
  label,
  placeholder,
  readOnly,
  toolbar,
}: {
  editor: Editor;
  className?: string;
  label?: string;
  placeholder?: string;
  readOnly?: boolean;
  /** Rendered above the content; omitted when read-only. */
  toolbar?: ReactNode;
}) {
  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  return (
    <div role="group" aria-label={label} className={className}>
      {readOnly ? null : toolbar}
      <div className="relative">
        {readOnly ? null : <EditorPlaceholder editor={editor} text={placeholder} />}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** Hint text shown while the document is empty. Tiptap's Placeholder
 *  extension lives in @tiptap/extensions (not a direct dependency), so
 *  this is a plain overlay driven by the editor's empty state. */
function EditorPlaceholder({ editor, text }: { editor: Editor; text?: string }) {
  const isEmpty = useEditorState({
    editor,
    selector: ({ editor }) => editor.isEmpty,
  });
  if (!text || !isEmpty) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-3 top-3 text-xs text-ink-4"
    >
      {text}
    </div>
  );
}
