/**
 * Note Editor — back-compat alias for the shared rich-text editor.
 *
 * The Tiptap wrapper originally lived here; when the email composers
 * needed the same editor (Email v1.1) the implementation moved to
 * `src/components/shared/rich-text-editor.tsx`. This pure re-export
 * keeps every notes surface (note composer, note replies, captures,
 * calendar event notes) on its existing import path with identical
 * behavior.
 */

export { RichTextEditor as NoteEditor } from "@/components/shared/rich-text-editor";
