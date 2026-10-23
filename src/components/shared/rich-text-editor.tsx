/**
 * Rich Text Editor — the app's shared Tiptap wrapper.
 *
 * Thin client-only wrapper around Tiptap's useEditor. Emits HTML on
 * change via `onChange`; the surrounding form posts the HTML string
 * to a server action where it's SANITIZED before it's stored or
 * sent (`src/lib/sanitize-html.ts` — note profile).
 *
 * Consumers: matter notes / note replies / captures / calendar event
 * notes (via the `NoteEditor` alias in
 * `src/components/matters/notes/note-editor.tsx`, where this
 * implementation originally lived) and the email compose / reply
 * composers (Email v1.1).
 *
 * Presets (`preset` prop, default "notes"):
 *   - notes: headings, bold, italic, strike, inline code, block code,
 *     blockquote, lists. Lockstep with the note-profile sanitizer.
 *   - email: notes plus underline, paragraph alignment, links and
 *     plain tables, with template paragraph styles kept. Lockstep with
 *     `sanitizeOutgoingEmailHtml`, which the send actions and the
 *     signature save use. Used by compose, reply and the signature.
 */

"use client";

import { useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Heading2, Quote } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlignButtons,
  Divider,
  LinkButton,
  ListButtons,
  MarkButtons,
  TableMenu,
  ToolButton,
} from "@/components/editor/controls";
import { emailExtensions, notesExtensions } from "@/components/editor/presets";
import { EDITOR_CONTENT_CLASS, EditorShell } from "@/components/editor/editor-shell";

export function RichTextEditor({
  initialHTML,
  onChange,
  placeholder,
  className,
  autoFocus,
  preset = "notes",
}: {
  initialHTML?: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  preset?: "notes" | "email";
}) {
  const editor = useEditor({
    extensions: preset === "email" ? emailExtensions() : notesExtensions(),
    content: initialHTML ?? "",
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none text-xs text-ink leading-relaxed",
          "focus:outline-none min-h-[90px] px-3 py-2",
          // Tailwind-typography overrides so the content reads naturally
          // at our text-xs baseline (it defaults to text-base elsewhere).
          "[&_p]:my-1 [&_p]:text-xs [&_p]:text-ink",
          "[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1",
          "[&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-0.5",
          EDITOR_CONTENT_CLASS,
          "[&_ul]:my-1 [&_ol]:my-1 [&_li]:text-xs",
        ),
        ...(placeholder ? { "aria-placeholder": placeholder } : {}),
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
    // Next.js 16 + React 19 SSR guard — avoid hydration mismatch by
    // letting the client initialize the editor after mount.
    immediatelyRender: false,
  });

  if (!editor) {
    return (
      <div
        className={cn(
          "border border-line rounded-md bg-white",
          "min-h-[120px] px-3 py-2 text-xs text-ink-4",
          className,
        )}
      >
        Loading editor…
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border border-line rounded-md bg-white overflow-hidden",
        "focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500/30",
        className,
      )}
    >
      <EditorShell
        editor={editor}
        placeholder={placeholder}
        toolbar={<EditorToolbar editor={editor} preset={preset} />}
      />
    </div>
  );
}

function EditorToolbar({ editor, preset }: { editor: Editor; preset: "notes" | "email" }) {
  const email = preset === "email";
  // Tiptap 3 does not re-render on transactions by default, so reading
  // editor.isActive() during render leaves the buttons (and
  // aria-pressed) stale after a selection change or a stored-mark
  // toggle. Subscribe to just the booleans the toolbar shows.
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      heading: editor.isActive("heading", { level: 2 }),
      blockquote: editor.isActive("blockquote"),
    }),
  });
  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-line bg-paper-2/40">
      <ToolButton
        label="Heading"
        active={active.heading}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={13} />
      </ToolButton>
      <Divider />
      <MarkButtons
        editor={editor}
        marks={
          email
            ? ["bold", "italic", "underline", "strike", "code"]
            : ["bold", "italic", "strike", "code"]
        }
      />
      <Divider />
      <ListButtons editor={editor} bulletLabel="Bullet list" />
      <ToolButton
        label="Quote"
        active={active.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={13} />
      </ToolButton>
      {email && (
        <>
          <Divider />
          <AlignButtons editor={editor} />
          <LinkButton editor={editor} />
          <TableMenu
            editor={editor}
            features={{ merge: false, borders: false, width: false, valign: false }}
          />
        </>
      )}
    </div>
  );
}
