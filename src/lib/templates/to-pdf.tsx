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
import { lineFactor, type ResolvedParagraphStyle } from "./resolve-styles";
import { SMALL_CAPS_SCALE, smallCapsRuns } from "./small-caps";
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
  ResolvedMark,
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
  splitLayout,
  tableGrid,
  verticalAlignOf,
  type GridCell,
  type Layout,
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

const PAGE_LINE_SPACING = { 1: "single", 1.15: "1.15", 1.5: "1.5", 2: "double" } as const;

type ParaBlock = Extract<ResolvedBlock, { type: "paragraph" | "heading" }>;

/** A paragraph's finished style values. The render engine always sets them;
 *  hand-built docs and headings fall back to the page's styles. */
function resolvedOf(b: ParaBlock, style: PageStyle): ResolvedParagraphStyle {
  if (b.type === "paragraph" && b.attrs?.resolved) return b.attrs.resolved;
  const level = b.type === "heading" ? b.attrs.level : null;
  const align = (b.type === "heading" ? b.attrs.textAlign : b.attrs?.textAlign) ?? "left";
  return {
    sizePt: level ? headingSizePt(style.sizePt, level) : style.sizePt,
    bold: level !== null,
    italic: false,
    underline: false,
    smallCaps: false,
    allCaps: false,
    align,
    indentLeftIn: 0,
    indentRightIn: 0,
    firstLine: { kind: "none" },
    spaceBeforePt: 0,
    spaceAfterPt: style.spaceAfterPt,
    lineSpacing: PAGE_LINE_SPACING[style.lineSpacing],
    keepWithNext: false,
    keepLinesTogether: false,
    pageBreakBefore: false,
    key: level ? `heading${level}` : "body",
    known: true,
  };
}

/** react-pdf's unitless lineHeight: a multiple of the font size. A multiple
 *  of the font's natural line height as Word does; exact spacing is points. */
function lineMultiple(r: ResolvedParagraphStyle, style: PageStyle, sizePt: number): number {
  const factor = lineFactor(r.lineSpacing);
  if (factor === null) return (r.lineSpacing as { exactPt: number }).exactPt / sizePt;
  const f = glyphFont(style.font);
  return (factor * (f.ascent - f.descent + f.lineGap)) / f.unitsPerEm;
}

const markPt = (marks: ResolvedMark[] | undefined) =>
  marks?.find((m) => m.type === "fontSize")?.attrs?.pt;

/** `r`: the paragraph's values, which fill in what a run's own marks don't. */
function inline(
  nodes: ResolvedInline[] | undefined,
  r: ResolvedParagraphStyle,
  indentPt: number,
): ReactNode[] {
  if (!nodes?.length) return [" "];
  return nodes.map((n, i) => {
    if (n.type === "hardBreak") {
      // react-pdf reads the first-line indent from the first run, so a
      // leading break carries it.
      return i === 0 && indentPt ? (
        <Text key={i} style={{ textIndent: indentPt }}>
          {"\n"}
        </Text>
      ) : (
        "\n"
      );
    }
    const types = new Set((n.marks ?? []).map((m) => m.type));
    const pt = markPt(n.marks);
    const text =
      types.has("smallCaps") || r.smallCaps
        ? smallCapsRuns(n.text).map((run, j) =>
            run.small ? (
              <Text key={j} style={{ fontSize: (pt ?? r.sizePt) * SMALL_CAPS_SCALE }}>
                {run.text}
              </Text>
            ) : (
              run.text
            ),
          )
        : n.text;
    return (
      <Text
        key={i}
        style={{
          fontWeight: types.has("bold") || r.bold ? "bold" : "normal",
          fontStyle: types.has("italic") || r.italic ? "italic" : "normal",
          textDecoration: types.has("underline") || r.underline ? "underline" : "none",
          // react-pdf reads the indent from the first run only.
          ...(i === 0 && indentPt ? { textIndent: indentPt } : {}),
          ...(types.has("allCaps") ? { textTransform: "uppercase" as const } : {}),
          ...(pt !== undefined ? { fontSize: pt } : {}),
          ...(types.has("missing") ? { backgroundColor: "#FFFF00" } : {}),
        }}
      >
        {text}
      </Text>
    );
  });
}

/** `textWidth`: points between the margins, which full-width tables fill.
 *  `inCell`: paragraphs there have no space after unless set directly. */
type Ctx = { style: PageStyle; textWidth: number; inCell?: boolean };

/** Height of a paragraph's first line, in points; 0 for anything else. */
function firstLinePt(b: ResolvedBlock | undefined, ctx: Ctx): number {
  if (b?.type !== "paragraph" && b?.type !== "heading") return 0;
  const r = resolvedOf(b, ctx.style);
  return r.sizePt * lineMultiple(r, ctx.style, r.sizePt);
}

/**
 * keepWithNext: `minPresenceAhead` on the paragraph's Text asks react-pdf to
 * break before it unless the next `nextLinePt` points (the following
 * paragraph's first line) also fit on the page. An approximation: only the
 * next paragraph's first line is reserved. Covered by a to-pdf test.
 */
function paragraph(key: string | number, b: ParaBlock, ctx: Ctx, nextLinePt: number) {
  const { style } = ctx;
  const r = resolvedOf(b, style);
  const direct = b.type === "paragraph" && b.attrs?.spaceAfterPt !== undefined;
  const fl = r.firstLine;
  const indentPt = fl.kind === "none" ? 0 : (fl.kind === "hanging" ? -fl.in : fl.in) * PT_PER_IN;
  return (
    <Text
      key={key}
      break={r.pageBreakBefore}
      wrap={!r.keepLinesTogether}
      minPresenceAhead={r.keepWithNext && nextLinePt > 0 ? nextLinePt : undefined}
      style={{
        fontSize: r.sizePt,
        fontWeight: r.bold ? "bold" : "normal",
        lineHeight: lineMultiple(r, style, r.sizePt),
        marginTop: r.spaceBeforePt,
        marginBottom: ctx.inCell && !direct ? 0 : r.spaceAfterPt,
        paddingLeft: r.indentLeftIn * PT_PER_IN,
        paddingRight: r.indentRightIn * PT_PER_IN,
        ...(r.allCaps ? { textTransform: "uppercase" as const } : {}),
        textAlign: r.align,
      }}
    >
      {inline(b.content, r, indentPt)}
    </Text>
  );
}

function blocks(list: ResolvedBlock[], ctx: Ctx): ReactElement[] {
  return list.map((b, i): ReactElement => {
    switch (b.type) {
      case "paragraph":
      case "heading":
        return paragraph(i, b, ctx, firstLinePt(list[i + 1], ctx));
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
              // The marker takes the item paragraph's size and spacing.
              const first = li.content[0];
              const r =
                first?.type === "paragraph" || first?.type === "heading"
                  ? resolvedOf(first, ctx.style)
                  : null;
              const size = r?.sizePt ?? ctx.style.sizePt;
              return (
                <View key={j} style={{ flexDirection: "row", marginLeft: LIST_INDENT }}>
                  <Text
                    style={{
                      width: LIST_INDENT,
                      fontSize: size,
                      lineHeight: r ? lineMultiple(r, ctx.style, size) : lineHeightFor(ctx.style),
                      marginTop: r?.spaceBeforePt ?? 0,
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
            const r = resolvedOf(b, ctx.style);
            const lines = [0];
            for (const n of b.content ?? []) {
              if (n.type === "hardBreak") lines.push(0);
              else {
                const marks = new Set<string>((n.marks ?? []).map((m) => m.type));
                if (r.bold) marks.add("bold");
                if (r.italic) marks.add("italic");
                const size = markPt(n.marks) ?? r.sizePt;
                const caps = r.allCaps || marks.has("allCaps");
                const str = caps ? n.text.toUpperCase() : n.text;
                lines[lines.length - 1] +=
                  marks.has("smallCaps") || r.smallCaps
                    ? smallCapsRuns(str).reduce(
                        (w, run) =>
                          w +
                          textWidth(
                            run.text,
                            marks,
                            ctx,
                            run.small ? size * SMALL_CAPS_SCALE : size,
                          ),
                        0,
                      )
                    : textWidth(str, marks, ctx, size);
              }
            }
            const fl = r.firstLine;
            const pad =
              (r.indentLeftIn + r.indentRightIn + (fl.kind === "indent" ? fl.in : 0)) * PT_PER_IN;
            return indent + pad + Math.max(...lines);
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

/** Bands of up to this many rows (a caption, a merged block) never
 *  split across pages; taller ones may, rather than overflow a page. */
const KEEP_TOGETHER_ROWS = 10;

const VALIGN = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

/**
 * Drawn from `splitLayout`: stacked bands (each kept on one page) of
 * side-by-side pieces that stretch to one height, so a cell spanning
 * rows fills its rows. Pieces stacked beside a taller one share the
 * extra height. Each cell draws its bottom and right rule; the top row
 * also draws the top and the first column the left, so every edge is
 * drawn once and a table split across pages keeps its bottom line on
 * each page. `textWidth` is the width the table sits in.
 */
function table(key: number, t: ResolvedTable, ctx: Ctx) {
  const grid = tableGrid(t);
  const widths =
    t.attrs?.width === "fit"
      ? fitColumnWidths(grid, (c) => naturalWidth(c, ctx), PT_PER_PX, ctx.textWidth)
      : columnFractions(grid).map((f) => f * ctx.textWidth);
  // Saved content always splits (the schema checks); anything else falls
  // back to plain rows: a row-spanning cell draws in its first row only,
  // with blank space under it so later cells keep their columns.
  const layout: Layout<GridCell> = splitLayout(grid.rows.flat(), grid.height, grid.cols) ?? {
    kind: "rows",
    box: { row: 0, col: 0, rowSpan: grid.height, span: grid.cols },
    children: grid.owner.map((cells, row) => ({
      kind: "cols",
      box: { row, col: 0, rowSpan: 1, span: grid.cols },
      children: cells.flatMap((g, col): Layout<GridCell>[] => {
        if (g.col !== col) return [];
        const box = { row, col, rowSpan: 1, span: g.span };
        return [
          g.row === row ? { kind: "cell", box: { ...g, rowSpan: 1 } } : { kind: "empty", box },
        ];
      }),
    })),
  };
  const draw = (n: Layout<GridCell>, k: number, parent: "rows" | "cols"): ReactElement => {
    const fill = parent === "rows" ? { flexGrow: 1 } : {};
    if (n.kind === "cell") return cell(n.box, k, widths, fill, ctx);
    const width = spannedWidth(n.box, widths);
    if (n.kind === "empty") return <View key={k} style={{ width, ...fill }} />;
    return (
      <View key={k} style={{ width, flexDirection: n.kind === "rows" ? "column" : "row", ...fill }}>
        {n.children.map((c, i) => draw(c, i, n.kind as "rows" | "cols"))}
      </View>
    );
  };
  const bands = layout.kind === "rows" ? layout.children : [layout];
  return (
    <View
      key={key}
      style={{ marginBottom: ctx.style.spaceAfterPt, width: widths.reduce((a, b) => a + b, 0) }}
    >
      {bands.map((band, j) => (
        // A band stays on one page unless it is so tall it may not fit.
        <View key={j} wrap={band.box.rowSpan > KEEP_TOGETHER_ROWS} style={{ flexDirection: "row" }}>
          {draw(band, 0, "cols")}
        </View>
      ))}
    </View>
  );
}

function cell(g: GridCell, key: number, widths: number[], fill: { flexGrow?: number }, ctx: Ctx) {
  const b = g.borders;
  const width = spannedWidth(g, widths);
  const inner = { ...ctx, textWidth: width - 2 * CELL_PAD_PT - BORDER_PT.thick * 2 };
  return (
    <View
      key={key}
      style={{
        width,
        ...fill,
        paddingLeft: CELL_PAD_PT,
        paddingRight: CELL_PAD_PT,
        justifyContent: VALIGN[verticalAlignOf(g.cell)],
        borderColor: BORDER_COLOR,
        borderTopWidth: g.row === 0 ? BORDER_PT[b.top] : 0,
        borderLeftWidth: g.col === 0 ? BORDER_PT[b.left] : 0,
        borderBottomWidth: BORDER_PT[b.bottom],
        borderRightWidth: BORDER_PT[b.right],
      }}
    >
      {blocks(g.cell.content, { ...inner, inCell: true, style: { ...ctx.style, spaceAfterPt: 0 } })}
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
