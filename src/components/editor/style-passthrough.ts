/**
 * Email-editor style passthrough.
 *
 * Template and signature HTML carries inline `style` (paragraph spacing,
 * cell alignment, span size/caps) that the schema has no attribute for.
 * This keeps it as a `style` attribute on paragraphs and table cells, and
 * as a minimal `styledSpan` mark for `<span style>`, filtering on BOTH
 * parse and render through `cleanOutgoingStyleValue`: the same function
 * the server's outgoing sanitizer uses, so the editor can never hold a
 * style the server would strip (and vice versa).
 *
 * Paragraph `text-align` is left to TextAlign (it owns that attribute),
 * so it is dropped here to avoid emitting it twice.
 */

import { Extension, Mark } from "@tiptap/core";
import { cleanOutgoingStyleValue } from "@/lib/sanitize-html";

type StyleTag = "p" | "span" | "td" | "th";

function clean(style: string | null | undefined, tag: StyleTag): string | null {
  if (!style) return null;
  let value = cleanOutgoingStyleValue(style, tag);
  if (tag === "p") {
    value = value
      .split(";")
      // Relies on the cleaner's normalised `prop:value` form (no spaces).
      .filter((d) => !d.startsWith("text-align:"))
      .join(";");
  }
  return value || null;
}

const attr = (tag: StyleTag) => ({
  default: null,
  parseHTML: (el: HTMLElement) => clean(el.getAttribute("style"), tag),
  renderHTML: (a: { style?: string | null }) => {
    const value = clean(a.style, tag);
    return value ? { style: value } : {};
  },
});

export const StylePassthrough = Extension.create({
  name: "stylePassthrough",
  addGlobalAttributes() {
    return [
      { types: ["paragraph"], attributes: { style: attr("p") } },
      { types: ["tableCell"], attributes: { style: attr("td") } },
      { types: ["tableHeader"], attributes: { style: attr("th") } },
    ];
  },
});

/** `<span style>` (font-size / uppercase from templates) as a mark. */
export const StyledSpan = Mark.create({
  name: "styledSpan",
  // Nested styled spans must coexist (default excludes self-type and would
  // drop the outer style); each keeps its own style and re-nests on render.
  excludes: "",
  addAttributes() {
    return { style: { default: null } };
  },
  parseHTML: () => [
    {
      tag: "span[style]",
      getAttrs: (el) => {
        const style = clean((el as HTMLElement).getAttribute("style"), "span");
        return style ? { style } : false;
      },
    },
  ],
  renderHTML: ({ HTMLAttributes }) => {
    const style = clean(HTMLAttributes.style as string | undefined, "span");
    return ["span", style ? { style } : {}, 0];
  },
});
