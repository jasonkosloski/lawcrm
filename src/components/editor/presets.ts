/**
 * Named editor presets: the extension set for each surface.
 *
 * Each preset must stay in lockstep with its server-side gate (notes:
 * the note-profile sanitizer; document: `validateTemplateContent`).
 * `presets.test.ts` pins that parity.
 *
 * NOTE: `documentExtensions` imports from `templates/editor/extensions`
 * (a temporary dependency direction; only table commands move later).
 */

import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  createTemplateExtensions,
  type TemplateExtensionOptions,
} from "@/components/templates/editor/extensions";

export type EditorPreset = "notes" | "email" | "document";

/**
 * Notes: headings 2-3, bold/italic/strike/code, blockquote, lists and
 * code blocks. `horizontalRule` is OFF: StarterKit would turn a typed
 * `---` into `<hr>`, which the note-profile sanitizer strips on save.
 * A pasted `<hr>` is dropped by ProseMirror's schema instead.
 */
export function notesExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      horizontalRule: false,
    }),
  ];
}

/** Document: the template editor's full node/mark set. */
export function documentExtensions(opts: TemplateExtensionOptions): Extensions {
  return createTemplateExtensions(opts);
}
