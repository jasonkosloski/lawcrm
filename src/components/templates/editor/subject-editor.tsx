/**
 * One-line email subject editor: the sms extension set (text + field
 * chips, no formatting) with Enter and Shift+Enter swallowed so the
 * subject stays a single paragraph. Hands its editor instance up via
 * `onEditor` so the toolbar can insert fields into it.
 */

"use client";

import { useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { Fragment, Slice, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import type { TemplateDoc } from "@/lib/templates/schema";
import { createTemplateExtensions } from "./extensions";
import { FitHighlight } from "./fit-highlight";

/** A pasted multi-paragraph slice as one line: paragraphs and line
 *  breaks become spaces, so the subject stays a single paragraph. */
export function flattenPasted(slice: Slice, schema: Schema): Slice {
  if (slice.content.childCount <= 1 && !hasBreak(slice.content)) return slice;
  const inline: PMNode[] = [];
  const space = () => {
    if (inline.length > 0) inline.push(schema.text(" "));
  };
  slice.content.forEach((block) => {
    if (!block.isTextblock) {
      if (block.isText || block.isInline) {
        inline.push(block.type.name === "hardBreak" ? schema.text(" ") : block);
      } else if (block.textContent) {
        space();
        inline.push(schema.text(block.textContent));
      }
      return;
    }
    space();
    block.forEach((n) => inline.push(n.type.name === "hardBreak" ? schema.text(" ") : n));
  });
  const para = schema.nodes.paragraph.create(null, inline);
  return new Slice(Fragment.from(para), 1, 1);
}

function hasBreak(f: Fragment): boolean {
  let found = false;
  f.descendants((n) => {
    if (n.type.name === "hardBreak") found = true;
    return !found;
  });
  return found;
}

const EMPTY: TemplateDoc = { type: "doc", content: [{ type: "paragraph" }] };

export function SubjectEditor({
  initial,
  editable,
  onChange,
  onFocus,
  onEditField,
  onEditor,
}: {
  initial: TemplateDoc | null;
  editable: boolean;
  onChange: (doc: TemplateDoc) => void;
  onFocus: () => void;
  /** Must be stable (it is baked into the extensions at creation). */
  onEditField: (pos: number) => void;
  onEditor: (editor: Editor | null) => void;
}) {
  const [extensions] = useState(() => [
    ...createTemplateExtensions({ kind: "sms", isBlock: false, blocks: [], onEditField }),
    FitHighlight,
  ]);
  const [editorProps] = useState(() => ({
    attributes: {
      "aria-label": "Subject",
      class: "min-h-8 px-2.5 py-1.5 text-xs text-ink focus:outline-none [&_p]:m-0",
    },
    handleKeyDown: (_view: unknown, event: KeyboardEvent) => event.key === "Enter",
    transformPasted: (slice: Slice, view: { state: { schema: Schema } }) =>
      flattenPasted(slice, view.state.schema),
  }));
  const editor = useEditor(
    {
      extensions,
      content: (initial ?? EMPTY) as never,
      editable,
      immediatelyRender: false,
      editorProps,
      onUpdate: ({ editor: e }) => onChange(e.getJSON() as TemplateDoc),
      onFocus,
    },
    [],
  );

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-2">Subject</span>
      <div className="rounded-md border border-line bg-white focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500/30">
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="h-8 px-2.5 py-1.5 text-xs text-ink-4">Loading…</div>
        )}
      </div>
    </div>
  );
}
