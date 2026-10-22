/**
 * ResolvedDoc -> PDF bytes, applying the firm's house PageStyle. Mirrors
 * to-docx.ts so both outputs share one layout.
 *
 * Header strategy: ONE `fixed` in-flow View at the top of every page whose
 * `render` returns the letterhead on page 1 and the continuation header
 * (plus "Page N") on later pages. react-pdf recomputes a dynamic node's
 * height per page, so body text starts below whatever that page's header
 * is and never overlaps it. Word's rule: the header starts at the header
 * distance from the page top and the body at max(top margin, header
 * distance + header height). So letters pad the page top by the header
 * distance and give the header View a min height of (top margin - header
 * distance). The filing page number is an absolutely positioned fixed
 * footer inside the bottom margin.
 */
import "server-only";
import { Document, Font, Image, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { openSync, type Font as GlyphFont } from "fontkit";
import type { ReactElement, ReactNode } from "react";
import { FONTS, type FontKey } from "./fonts";
import { fontFilePath } from "./fonts-server";
import { imageSize } from "./image-size";
import {
  CELL_PAD_PT,
  HEADER_DISTANCE_PT,
  headingSizePt,
  PAGE_DIMENSIONS,
  type LoadedLogo,
  type PageStyle,
} from "./page-style";
import type {
  ResolvedBlock,
  ResolvedDoc,
  ResolvedInline,
  ResolvedTable,
  ResolvedTableCell,
} from "./render";
import {
  BORDER_PT,
  columnFractions,
  fitColumnWidths,
  spannedWidth,
  tableGrid,
  verticalAlignOf,
  type GridCell,
} from "./table-layout";

const FALLBACK_FAMILY = "Liberation Sans";
/** Last-resort glyphs the text fonts lack (ballot boxes ☐ ☑ ☒, check
 *  marks). One face serves every weight and style. */
const SYMBOL_FAMILY = "DejaVu Sans";
const SYMBOL_FILE = "DejaVuSans.ttf";
const PT_PER_IN = 72;
/** imageSize reports pixels; Word places them at 96 dpi. */
const PT_PER_PX = 72 / 96;
const LOGO_MAX_W_PT = 3 * PT_PER_IN;
const LOGO_MAX_H_PT = 1 * PT_PER_IN;
const LIST_INDENT = 18; // marker column and per-level indent, in points
const BORDER_COLOR = "#000000";

const registered = new Set<string>();

function registerFamily(family: string, files: (typeof FONTS)[FontKey]["files"]) {
  if (registered.has(family)) return;
  Font.register({
    family,
    fonts: [
      { src: fontFilePath(files.regular), fontWeight: "normal", fontStyle: "normal" },
      { src: fontFilePath(files.bold), fontWeight: "bold", fontStyle: "normal" },
      { src: fontFilePath(files.italic), fontWeight: "normal", fontStyle: "italic" },
      { src: fontFilePath(files.boldItalic), fontWeight: "bold", fontStyle: "italic" },
    ],
  });
  registered.add(family);
}

let hyphenationOff = false;

function ensureFonts(key: FontKey) {
  // react-pdf hyphenates long words by default; Word does not.
  if (!hyphenationOff) {
    Font.registerHyphenationCallback((word) => [word]);
    hyphenationOff = true;
  }
  registerFamily(FONTS[key].pdfFamily, FONTS[key].files);
  registerFamily(FALLBACK_FAMILY, FONTS.arial.files);
  registerFamily(SYMBOL_FAMILY, {
    regular: SYMBOL_FILE,
    bold: SYMBOL_FILE,
    italic: SYMBOL_FILE,
    boldItalic: SYMBOL_FILE,
  });
}

const glyphFonts = new Map<string, GlyphFont>();
function glyphFile(file: string): GlyphFont {
  let f = glyphFonts.get(file);
  if (!f) {
    f = openSync(fontFilePath(file));
    glyphFonts.set(file, f);
  }
  return f;
}
const glyphFont = (key: FontKey) => glyphFile(FONTS[key].files.regular);

/** Word's "single" is the font's natural line height, which react-pdf's
 *  unitless lineHeight (a multiple of font size) does not default to. */
function lineHeightFor(style: PageStyle): number {
  const f = glyphFont(style.font);
  return (style.lineSpacing * (f.ascent - f.descent + f.lineGap)) / f.unitsPerEm;
}

function collectText(doc: ResolvedDoc | null, out: string[]) {
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const o = n as { type?: string; text?: string; content?: unknown[] };
    if (o.type === "text" && typeof o.text === "string") out.push(o.text);
    o.content?.forEach(walk);
  };
  walk(doc);
}

/** True when any code point has no glyph in the chosen font or a fallback. */
function hasUnsupported(key: FontKey, strings: string[]): boolean {
  const font = glyphFont(key);
  const fallback = glyphFont("arial"); // Liberation Sans, the registered fallback
  const symbols = glyphFile(SYMBOL_FILE);
  const seen = new Set<number>();
  for (const s of strings) {
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (seen.has(cp)) continue;
      seen.add(cp);
      if (cp <= 0x20 || (cp >= 0x7f && cp <= 0xa0) || cp === 0x200b) continue; // whitespace, controls
      if (
        !font.hasGlyphForCodePoint(cp) &&
        !fallback.hasGlyphForCodePoint(cp) &&
        !symbols.hasGlyphForCodePoint(cp)
      ) {
        return true;
      }
    }
  }
  return false;
}

type Align = "left" | "center" | "right" | "justify";

function inline(nodes: ResolvedInline[] | undefined): ReactNode[] {
  if (!nodes?.length) return [" "];
  return nodes.map((n, i) => {
    if (n.type === "hardBreak") return "\n";
    const types = new Set((n.marks ?? []).map((m) => m.type));
    return (
      <Text
        key={i}
        style={{
          fontWeight: types.has("bold") ? "bold" : "normal",
          fontStyle: types.has("italic") ? "italic" : "normal",
          textDecoration: types.has("underline") ? "underline" : "none",
          ...(types.has("missing") ? { backgroundColor: "#FFFF00" } : {}),
        }}
      >
        {n.text}
      </Text>
    );
  });
}

/** `textWidth`: points between the margins, which full-width tables fill. */
type Ctx = { style: PageStyle; textWidth: number };

function paragraph(
  key: string | number,
  content: ResolvedInline[] | undefined,
  align: Align | null | undefined,
  ctx: Ctx,
  heading?: 1 | 2 | 3,
) {
  const { style } = ctx;
  return (
    <Text
      key={key}
      style={{
        fontSize: heading ? headingSizePt(style.sizePt, heading) : style.sizePt,
        fontWeight: heading ? "bold" : "normal",
        lineHeight: lineHeightFor(style),
        marginBottom: style.spaceAfterPt,
        textAlign: align ?? "left",
      }}
    >
      {inline(content)}
    </Text>
  );
}

function blocks(list: ResolvedBlock[], ctx: Ctx): ReactElement[] {
  return list.map((b, i): ReactElement => {
    switch (b.type) {
      case "paragraph":
        return paragraph(i, b.content, b.attrs?.textAlign, ctx);
      case "heading":
        return paragraph(i, b.content, b.attrs.textAlign, ctx, b.attrs.level);
      case "bulletList":
      case "orderedList": {
        // Each ordered list numbers from 1; nested lists sit inside the
        // item's content column so they indent by one marker width.
        let n = 0;
        return (
          <View key={i}>
            {b.content.map((li, j) => {
              n++;
              const marker = b.type === "bulletList" ? "•" : `${n}.`;
              return (
                <View key={j} style={{ flexDirection: "row", marginLeft: LIST_INDENT }}>
                  <Text
                    style={{
                      width: LIST_INDENT,
                      fontSize: ctx.style.sizePt,
                      lineHeight: lineHeightFor(ctx.style),
                    }}
                  >
                    {marker}
                  </Text>
                  <View style={{ flex: 1 }}>
                    {blocks(li.content, { ...ctx, textWidth: ctx.textWidth - 2 * LIST_INDENT })}
                  </View>
                </View>
              );
            })}
          </View>
        );
      }
      case "table":
        return table(i, b, ctx);
      case "pageBreak":
        return <View key={i} break />;
    }
  });
}

/** Width of a run of text at the body size, in points. */
/** Width of a run of text, in points. Each character is measured in the
 *  face that will draw it: the chosen font, else a fallback. */
function textWidth(text: string, marks: Set<string>, ctx: Ctx, sizePt: number): number {
  const face = marks.has("bold")
    ? marks.has("italic")
      ? "boldItalic"
      : "bold"
    : marks.has("italic")
      ? "italic"
      : "regular";
  const faces = [
    glyphFile(FONTS[ctx.style.font].files[face]),
    glyphFile(FONTS.arial.files[face]),
    glyphFile(SYMBOL_FILE),
  ];
  let total = 0;
  let run = "";
  let runFont = faces[0];
  const flush = () => {
    if (run) total += (runFont.layout(run).advanceWidth * sizePt) / runFont.unitsPerEm;
    run = "";
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const f = faces.find((x) => x.hasGlyphForCodePoint(cp)) ?? faces[0];
    if (f !== runFont) {
      flush();
      runFont = f;
    }
    run += ch;
  }
  flush();
  return total;
}

/** The widest line a cell's content would set on, plus its padding:
 *  what a fit-to-content column needs to avoid wrapping. */
function naturalWidth(c: ResolvedTableCell, ctx: Ctx): number {
  const widest = (list: ResolvedBlock[], indent: number): number =>
    Math.max(
      0,
      ...list.map((b): number => {
        switch (b.type) {
          case "paragraph":
          case "heading": {
            const size =
              b.type === "heading"
                ? headingSizePt(ctx.style.sizePt, b.attrs.level)
                : ctx.style.sizePt;
            const lines = [0];
            for (const n of b.content ?? []) {
              if (n.type === "hardBreak") lines.push(0);
              else {
                const marks = new Set<string>((n.marks ?? []).map((m) => m.type));
                if (b.type === "heading") marks.add("bold");
                lines[lines.length - 1] += textWidth(n.text, marks, ctx, size);
              }
            }
            return indent + Math.max(...lines);
          }
          case "bulletList":
          case "orderedList":
            return Math.max(
              0,
              ...b.content.map((li) => widest(li.content, indent + LIST_INDENT * 2)),
            );
          case "table":
            return indent + ctx.textWidth;
          case "pageBreak":
            return 0;
        }
      }),
    );
  // A little slack so rounding never wraps the widest line.
  return widest(c.content, 0) + 2 * CELL_PAD_PT + 2 * BORDER_PT.thick + 1;
}

const VALIGN = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

/**
 * Each cell draws its bottom and right rule; the first row also draws
 * the top and a row's first cell the left, so every edge is drawn once
 * and a table split across pages keeps its bottom line on each page.
 * `textWidth` is the width the table sits in (narrower in a list or cell).
 */
function table(key: number, t: ResolvedTable, ctx: Ctx) {
  const grid = tableGrid(t);
  const widths =
    t.attrs?.width === "fit"
      ? fitColumnWidths(grid, (c) => naturalWidth(c, ctx), PT_PER_PX, ctx.textWidth)
      : columnFractions(grid).map((f) => f * ctx.textWidth);
  return (
    <View
      key={key}
      style={{ marginBottom: ctx.style.spaceAfterPt, width: widths.reduce((a, b) => a + b, 0) }}
    >
      {grid.rows.map((r, j) => (
        <View key={j} style={{ flexDirection: "row" }} wrap={false}>
          {r.map((g, k) => cell(g, k, widths, j === 0, ctx))}
        </View>
      ))}
    </View>
  );
}

function cell(g: GridCell, key: number, widths: number[], firstRow: boolean, ctx: Ctx) {
  const b = g.borders;
  const width = spannedWidth(g, widths);
  const inner = { ...ctx, textWidth: width - 2 * CELL_PAD_PT - BORDER_PT.thick * 2 };
  return (
    <View
      key={key}
      style={{
        width,
        paddingLeft: CELL_PAD_PT,
        paddingRight: CELL_PAD_PT,
        justifyContent: VALIGN[verticalAlignOf(g.cell)],
        borderColor: BORDER_COLOR,
        borderTopWidth: firstRow ? BORDER_PT[b.top] : 0,
        borderLeftWidth: key === 0 ? BORDER_PT[b.left] : 0,
        borderBottomWidth: BORDER_PT[b.bottom],
        borderRightWidth: BORDER_PT[b.right],
      }}
    >
      {blocks(g.cell.content, { ...inner, style: { ...ctx.style, spaceAfterPt: 0 } })}
    </View>
  );
}

const JUSTIFY = { left: "flex-start", center: "center", right: "flex-end" } as const;

function logo(l: LoadedLogo, ctx: Ctx) {
  const size = imageSize(l.bytes, l.contentType);
  if (!size) return null; // undecodable: skipped, the caller warns
  const natW = size.width * PT_PER_PX;
  const natH = size.height * PT_PER_PX;
  const scale = Math.min(1, LOGO_MAX_W_PT / natW, LOGO_MAX_H_PT / natH);
  const w = natW * scale;
  const h = natH * scale;
  return (
    <View
      key="logo"
      style={{ alignItems: JUSTIFY[l.position], marginBottom: ctx.style.spaceAfterPt }}
    >
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an <img> */}
      <Image
        src={{ data: Buffer.from(l.bytes), format: l.contentType === "image/png" ? "png" : "jpg" }}
        style={{ width: w, height: h }}
      />
    </View>
  );
}

export async function resolvedToPdf(input: {
  body: ResolvedDoc;
  letterhead: ResolvedDoc | null;
  continuation: ResolvedDoc | null;
  style: PageStyle;
}): Promise<{ buffer: Buffer; warnings: string[] }> {
  const { style } = input;
  const isLetter = style.kind === "letter";
  ensureFonts(style.font);
  const ctx: Ctx = {
    style,
    textWidth:
      PAGE_DIMENSIONS[style.paperSize].pt.w -
      (style.marginsIn.left + style.marginsIn.right) * PT_PER_IN,
  };

  const strings: string[] = [];
  collectText(input.body, strings);
  if (isLetter) {
    if (style.letterhead) collectText(input.letterhead, strings);
    collectText(input.continuation, strings);
  }
  const warnings = hasUnsupported(style.font, strings)
    ? [`Some characters can't be shown in ${FONTS[style.font].label}.`]
    : [];

  const lg = style.letterhead?.logo;
  if (isLetter && lg && !imageSize(lg.bytes, lg.contentType)) {
    warnings.push("Logo couldn't be loaded.");
  }

  const family = [FONTS[style.font].pdfFamily, FALLBACK_FAMILY, SYMBOL_FAMILY];
  const m = style.marginsIn;
  const pt = (n: number) => n * PT_PER_IN;

  const firstHeader = () => {
    const parts: ReactElement[] = [];
    const mark = style.letterhead?.logo ? logo(style.letterhead.logo, ctx) : null;
    if (mark) parts.push(mark);
    if (style.letterhead && input.letterhead) {
      parts.push(<View key="lh">{blocks(input.letterhead.content ?? [], ctx)}</View>);
    }
    return parts;
  };
  const laterHeader = (pageNumber: number) => {
    const parts: ReactElement[] = [];
    if (input.continuation) {
      parts.push(<View key="ch">{blocks(input.continuation.content ?? [], ctx)}</View>);
    }
    if (style.pageNumbers !== "none") {
      parts.push(
        <Text
          key="pn"
          style={{
            textAlign: "right",
            fontSize: style.sizePt,
            lineHeight: lineHeightFor(style),
            marginBottom: style.spaceAfterPt,
          }}
        >
          {`Page ${pageNumber}`}
        </Text>,
      );
    }
    return parts;
  };
  const bodyBlocks = blocks(input.body.content ?? [], ctx);

  const pdf = (
    <Document>
      <Page
        size={[PAGE_DIMENSIONS[style.paperSize].pt.w, PAGE_DIMENSIONS[style.paperSize].pt.h]}
        style={{
          fontFamily: family,
          fontSize: style.sizePt,
          paddingTop: isLetter ? HEADER_DISTANCE_PT : pt(m.top),
          paddingBottom: pt(m.bottom),
          paddingLeft: pt(m.left),
          paddingRight: pt(m.right),
        }}
      >
        {isLetter && (
          <View
            fixed
            style={{ minHeight: Math.max(0, pt(m.top) - HEADER_DISTANCE_PT) }}
            render={({ pageNumber }) => {
              const parts = pageNumber === 1 ? firstHeader() : laterHeader(pageNumber);
              return parts.length ? <View>{parts}</View> : null;
            }}
          />
        )}
        {bodyBlocks}
        {!isLetter && style.pageNumbers !== "none" && (
          <View
            fixed
            style={{
              position: "absolute",
              bottom: Math.max(6, pt(m.bottom) / 2 - style.sizePt / 2),
              left: pt(m.left),
              right: pt(m.right),
            }}
            render={({ pageNumber }) =>
              pageNumber === 1 ? null : (
                <Text
                  style={{
                    fontSize: style.sizePt,
                    textAlign: style.pageNumbers === "bottom_right" ? "right" : "center",
                  }}
                >
                  {`Page ${pageNumber}`}
                </Text>
              )
            }
          />
        )}
      </Page>
    </Document>
  );
  return { buffer: await renderToBuffer(pdf), warnings };
}
