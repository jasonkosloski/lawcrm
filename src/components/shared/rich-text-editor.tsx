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
 * Toolbar exposes the handful of marks/nodes we care about
 * (headings, bold, italic, strike, inline code, block code,
 * blockquote, lists). No images/tables — this is workspace prose,
 * not a document editor. Keep the tag surface in lockstep with the
 * sanitizer's note-profile allowlist.
 */

"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function RichTextEditor({
  initialHTML,
  onChange,
  placeholder,
  className,
  autoFocus,
}: {
  initialHTML?: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
    ],
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
          "[&_ul]:my-1 [&_ol]:my-1 [&_li]:text-xs",
          "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-3 [&_blockquote]:italic",
          "[&_code]:bg-paper-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_code]:font-mono",
          "[&_pre]:bg-paper-2 [&_pre]:p-2 [&_pre]:rounded [&_pre]:text-[11px]"
        ),
        "data-placeholder": placeholder ?? "",
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
          className
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
        className
      )}
    >
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function EditorToolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-line bg-paper-2/40">
      <ToolbarButton
        label="Heading"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
      >
        <Heading2 size={13} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={13} />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={13} />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={13} />
      </ToolbarButton>
      <ToolbarButton
        label="Inline code"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code size={13} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={13} />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={13} />
      </ToolbarButton>
      <ToolbarButton
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={13} />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => {
        // Prevent the editor losing focus when the toolbar is clicked
        // so mark/node toggles apply to the active selection.
        e.preventDefault();
      }}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors",
        active
          ? "bg-brand-soft text-brand-700"
          : "text-ink-3 hover:bg-paper-2 hover:text-ink-2"
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-4 bg-line mx-0.5 shrink-0" />;
}
