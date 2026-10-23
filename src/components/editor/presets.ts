/**
 * Named editor presets: the extension set for each surface.
 *
 * Each preset must stay in lockstep with its server-side gate (notes:
 * the note-profile sanitizer; document: `validateTemplateContent`).
 * `presets.test.ts` pins that parity.
 */

import { mergeAttributes, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { isAllowedEmailLink } from "./link-uri";
import { StylePassthrough, StyledSpan } from "./style-passthrough";
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

function withoutColwidth(this: { parent?: () => Record<string, unknown> }) {
  return {
    ...this.parent?.(),
    colwidth: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
  };
}

/**
 * Email: Notes plus text alignment (paragraphs only), plain tables, a
 * strict Link, and the style passthrough. Mirrors
 * `sanitizeOutgoingEmailHtml`: links are http/https/mailto only with a
 * forced rel/target; style survives only as the server would keep it.
 */
export function emailExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      horizontalRule: false,
      link: {
        protocols: ["http", "https", "mailto"],
        autolink: true,
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        isAllowedUri: isAllowedEmailLink,
      },
    }),
    TextAlign.configure({ types: ["paragraph"] }),
    // Plain tables: no <colgroup>/min-width markup and no column widths,
    // which the outgoing sanitizer would strip.
    Table.extend({
      renderHTML({ HTMLAttributes }) {
        return [
          "table",
          mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
          ["tbody", 0],
        ];
      },
    }).configure({ resizable: false }),
    TableRow,
    TableCell.extend({ addAttributes: withoutColwidth }),
    TableHeader.extend({ addAttributes: withoutColwidth }),
    StylePassthrough,
    StyledSpan,
  ];
}

/** Document: the template editor's full node/mark set. */
export function documentExtensions(opts: TemplateExtensionOptions): Extensions {
  return createTemplateExtensions(opts);
}
