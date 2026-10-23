/**
 * ResolvedDoc -> sanitized HTML (preview and in-app display).
 *
 * Exports:
 * - `resolvedToHtml(doc)`: one sanitized HTML string (plain semantic markup).
 * - `resolvedToPageParts(input)`: the page-shaped preview model. Instead of
 *   one HTML string with inline CSS, it returns three sanitized fragments
 *   (body, letterhead, continuation) plus a plain style object and layout
 *   flags. `PagePreview` (components/templates/page-preview.tsx) renders the
 *   wrapper, strip, logo and CSS through React, so no raw style ever lives
 *   in user-controlled HTML and the sanitizer allowlist is unchanged.
 * - `pageFontFaceCss(font)`: @font-face rules for a font key's bundled files.
 */

import { sanitizeDocumentHtml } from "@/lib/sanitize-html";
import { FONTS, fontPublicUrl, type FontKey } from "./fonts";
import {
  CELL_PAD_PT,
  HEADER_DISTANCE_PT,
  PAGE_DIMENSIONS,
  type PreviewPageStyle,
} from "./page-style";
import type {
  ResolvedBlock,
  ResolvedDoc,
  ResolvedInline,
  ResolvedListItem,
  ResolvedTable,
} from "./render";
import { CELL_SIDES } from "./schema";
import { lineFactor } from "./resolve-styles";
import type { StyleValues } from "./paragraph-styles";
import {
  CELL_SIDE_ATTR,
  columnFractions,
  columnPx,
  tableGrid,
  verticalAlignOf,
  type GridCell,
} from "./table-layout";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Outermost first: missing wraps everything, then bold > italic >
// underline > small caps. [mark, opening tag body, closing tag].
const MARK_TAGS: [string, string, string][] = [
  ["bold", "strong", "strong"],
  ["italic", "em", "em"],
  ["underline", "u", "u"],
  ["smallCaps", "span data-small-caps", "span"],
];

/** Where a paragraph sits. Body paragraphs take their style's spacing; list
 *  and table-cell paragraphs have none unless set directly (Word and the PDF
 *  draw cell paragraphs flush, and the preview always did). */
type Where = "body" | "flush";

/** Word's "single" is the font's natural leading, about 1.15 em in CSS. */
const CSS_LINE_FACTOR = 1.15;
const num = (n: number) => String(+n.toFixed(2));

/** The inline style for a paragraph's resolved values. Every property is in
 *  the sanitizer's allowlist; email clients never see the preview CSS, so
 *  the in-app preview has no
 *  stylesheet for them. Sent emails do not keep these (the outgoing-mail
 *  sanitizer strips style attributes). */
function paragraphStyle(
  v: StyleValues,
  direct: { spaceBeforePt?: number; spaceAfterPt?: number } | undefined,
  where: Where,
): string {
  const flush = where === "flush";
  const before = flush ? (direct?.spaceBeforePt ?? 0) : v.spaceBeforePt;
  const after = flush ? (direct?.spaceAfterPt ?? 0) : v.spaceAfterPt;
  const factor = lineFactor(v.lineSpacing);
  const lineHeight =
    typeof v.lineSpacing === "object"
      ? `${num(v.lineSpacing.exactPt)}pt`
      : String(+((factor ?? 1) * CSS_LINE_FACTOR).toFixed(3));
  const firstLine =
    v.firstLine.kind === "indent"
      ? `${num(v.firstLine.in)}in`
      : v.firstLine.kind === "hanging"
        ? `${num(-v.firstLine.in)}in`
        : "0pt";
  const parts = [
    `margin-top:${num(before)}pt`,
    `margin-bottom:${num(after)}pt`,
    `margin-left:${num(v.indentLeftIn)}in`,
    `margin-right:${num(v.indentRightIn)}in`,
    `text-indent:${firstLine}`,
    `line-height:${lineHeight}`,
    `font-size:${num(v.sizePt)}pt`,
    `font-weight:${v.bold ? "bold" : "normal"}`,
    `font-style:${v.italic ? "italic" : "normal"}`,
    `text-transform:${v.allCaps ? "uppercase" : "none"}`,
    `font-variant:${v.smallCaps ? "small-caps" : "normal"}`,
    `text-align:${v.align}`,
  ];
  if (v.pageBreakBefore) parts.push("break-before:page");
  return parts.join(";");
}

function inline(nodes: ResolvedInline[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "hardBreak") return "<br />";
      const types = new Set((n.marks ?? []).map((m) => m.type));
      let out = esc(n.text);
      const size = (n.marks ?? []).find((m) => m.type === "fontSize")?.attrs?.pt;
      const css = [
        typeof size === "number" ? `font-size:${num(size)}pt` : "",
        types.has("allCaps") ? "text-transform:uppercase" : "",
      ].filter(Boolean);
      if (css.length) out = `<span style="${css.join(";")}">${out}</span>`;
      for (const [type, open, close] of [...MARK_TAGS].reverse()) {
        if (types.has(type as never)) out = `<${open}>${out}</${close}>`;
      }
      return types.has("missing") ? `<mark data-missing>${out}</mark>` : out;
    })
    .join("");
}

const align = (a?: string | null) => (a ? ` style="text-align:${a}"` : "");

const flushBlock = (b: ResolvedBlock) => block(b, "flush");

function listItem(li: ResolvedListItem): string {
  return `<li>${li.content.map(flushBlock).join("")}</li>`;
}

/** Borders and vertical alignment travel as data attributes the page
 *  CSS styles; only widths need an inline (sanitizer-validated) style.
 *  Sides are as declared: collapsed CSS resolves each shared segment. */
function cell(g: GridCell): string {
  const c = g.cell;
  const tag = c.type === "tableHeader" ? "th" : "td";
  let attrs = g.span > 1 ? ` colspan="${g.span}"` : "";
  if (g.rowSpan > 1) attrs += ` rowspan="${g.rowSpan}"`;
  for (const side of CELL_SIDES) {
    const w = g.declared[side];
    if (w !== "thin") attrs += ` ${CELL_SIDE_ATTR[side]}="${w}"`;
  }
  const va = verticalAlignOf(c);
  if (va !== "top") attrs += ` data-valign="${va}"`;
  return `<${tag}${attrs}>${c.content.map(flushBlock).join("")}</${tag}>`;
}

function table(t: ResolvedTable): string {
  const grid = tableGrid(t);
  const fit = t.attrs?.width === "fit";
  const px = columnPx(grid);
  const cols = fit
    ? px.map((w) => (w === null ? "<col>" : `<col style="width:${Math.round(w)}px">`))
    : columnFractions(grid).map((f) => `<col style="width:${(f * 100).toFixed(2)}%">`);
  const rows = grid.rows.map((r) => `<tr>${r.map(cell).join("")}</tr>`).join("");
  return `<table data-width="${fit ? "fit" : "full"}"><colgroup>${cols.join("")}</colgroup>${rows}</table>`;
}

/** Headings are ordinary paragraphs here: their size and weight travel in
 *  the inline style, so the page CSS's h1-h3 rules cannot double-apply. */
function block(b: ResolvedBlock, where: Where = "body"): string {
  switch (b.type) {
    case "paragraph": {
      const v = b.attrs?.resolved;
      if (!v) return `<p${align(b.attrs?.textAlign)}>${inline(b.content)}</p>`;
      const body = v.underline ? `<u>${inline(b.content)}</u>` : inline(b.content);
      return `<p style="${paragraphStyle(v, b.attrs, where)}">${body}</p>`;
    }
    case "heading":
      return `<h${b.attrs.level}${align(b.attrs.textAlign)}>${inline(b.content)}</h${b.attrs.level}>`;
    case "bulletList":
      return `<ul>${b.content.map(listItem).join("")}</ul>`;
    case "orderedList":
      return `<ol>${b.content.map(listItem).join("")}</ol>`;
    case "table":
      return table(b);
    case "pageBreak":
      return "<hr data-page-break>";
  }
}

export function resolvedToHtml(doc: ResolvedDoc): string {
  return sanitizeDocumentHtml((doc.content ?? []).map((b) => block(b)).join(""));
}

const PX_PER_IN = 96;
const PX_PER_PT = 96 / 72;

export const PAGE_WIDTH_PX = 8.5 * PX_PER_IN;
export const LOGO_MAX_W_PX = 3 * PX_PER_IN;
export const LOGO_MAX_H_PX = 1 * PX_PER_IN;
/** Table cell left/right padding, same as the .docx and PDF. */
export const CELL_PAD_PX = CELL_PAD_PT * PX_PER_PT;
/** Previewed family names are prefixed so they never clash with system fonts. */
export const previewFontFamily = (font: FontKey) => `Tpl ${FONTS[font].pdfFamily}`;

/** One @font-face per face of the font, pointing at the public files. */
export function pageFontFaceCss(font: FontKey): string {
  const def = FONTS[font];
  const faces: [keyof typeof def.files, string, string][] = [
    ["regular", "normal", "normal"],
    ["bold", "bold", "normal"],
    ["italic", "normal", "italic"],
    ["boldItalic", "bold", "italic"],
  ];
  return faces
    .map(
      ([k, weight, fstyle]) =>
        `@font-face{font-family:"${previewFontFamily(font)}";src:url("${fontPublicUrl(def.files[k])}");font-weight:${weight};font-style:${fstyle};font-display:swap;}`,
    )
    .join("\n");
}

export type PageParts = {
  /** Style props for the page element (CSS custom properties + padding). */
  style: Record<string, string>;
  /** Letters: min height of the header area (top margin - header distance),
   *  so the body starts at the top margin unless the header is taller
   *  (Word's rule). Null for filings, which pad the page by the margin. */
  headerMinHeightPx: number | null;
  fontFamily: string;
  /** Sanitized; null when no letterhead block. */
  letterheadHtml: string | null;
  /** Letters only; null when there is no logo to show. */
  logo: { url: string; position: "left" | "center" | "right" } | null;
  bodyHtml: string;
  /** The page frame's minimum height for its paper size. */
  minHeightPx: number;
  /** Page-2 strip; null when nothing would print there. */
  strip: {
    placement: "top" | "bottom";
    continuationHtml: string | null;
    pageLabel: { text: string; align: "left" | "center" | "right" } | null;
  } | null;
};

/** Mirrors the .docx/PDF layout rules; page 1 is never numbered. */
export function resolvedToPageParts(input: {
  body: ResolvedDoc;
  letterhead: ResolvedDoc | null;
  continuation: ResolvedDoc | null;
  style: PreviewPageStyle;
  logoUrl: string | null;
}): PageParts {
  const { style } = input;
  const isLetter = style.kind === "letter";
  const m = style.marginsIn;
  const numbered = style.pageNumbers !== "none";
  const continuationHtml =
    isLetter && input.continuation ? resolvedToHtml(input.continuation) : null;
  const logo = style.letterhead?.logo;
  let strip: PageParts["strip"] = null;
  if (isLetter) {
    if (continuationHtml || numbered) {
      strip = {
        placement: "top",
        continuationHtml,
        pageLabel: numbered ? { text: "Page 2", align: "right" } : null,
      };
    }
  } else if (numbered) {
    strip = {
      placement: "bottom",
      continuationHtml: null,
      pageLabel: {
        text: "Page 2",
        align: style.pageNumbers === "bottom_right" ? "right" : "center",
      },
    };
  }
  return {
    fontFamily: `"${previewFontFamily(style.font)}", serif`,
    style: {
      "--page-font-size": `${style.sizePt * PX_PER_PT}px`,
      // CSS line-height can't read font metrics; factor x 1.15 approximates
      // Word's "single" (the font's natural leading).
      "--page-line-height": String(style.lineSpacing * 1.15),
      "--page-space-after": `${style.spaceAfterPt * PX_PER_PT}px`,
      paddingTop: `${isLetter ? HEADER_DISTANCE_PT * PX_PER_PT : m.top * PX_PER_IN}px`,
      paddingRight: `${m.right * PX_PER_IN}px`,
      paddingBottom: `${m.bottom * PX_PER_IN}px`,
      paddingLeft: `${m.left * PX_PER_IN}px`,
    },
    headerMinHeightPx: isLetter
      ? Math.max(0, m.top * PX_PER_IN - HEADER_DISTANCE_PT * PX_PER_PT)
      : null,
    letterheadHtml:
      isLetter && style.letterhead && input.letterhead ? resolvedToHtml(input.letterhead) : null,
    logo:
      isLetter && logo && input.logoUrl ? { url: input.logoUrl, position: logo.position } : null,
    bodyHtml: resolvedToHtml(input.body),
    minHeightPx: PAGE_DIMENSIONS[style.paperSize].in.h * PX_PER_IN,
    strip,
  };
}
