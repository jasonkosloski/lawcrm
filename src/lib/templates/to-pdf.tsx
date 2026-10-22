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
import type { ResolvedBlock, ResolvedDoc, ResolvedInline, ResolvedTableCell } from "./render";

const FALLBACK_FAMILY = "Liberation Sans";
const PT_PER_IN = 72;
/** imageSize reports pixels; Word places them at 96 dpi. */
const PT_PER_PX = 72 / 96;
const LOGO_MAX_W_PT = 3 * PT_PER_IN;
const LOGO_MAX_H_PT = 1 * PT_PER_IN;
const LIST_INDENT = 18; // marker column and per-level indent, in points
const BORDER = { borderColor: "#000000", borderWidth: 0.5 } as const;

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
}

const glyphFonts = new Map<FontKey, GlyphFont>();
function glyphFont(key: FontKey): GlyphFont {
  let f = glyphFonts.get(key);
  if (!f) {
    f = openSync(fontFilePath(FONTS[key].files.regular));
    glyphFonts.set(key, f);
  }
  return f;
}

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

/** True when any code point has no glyph in the chosen font or the fallback. */
function hasUnsupported(key: FontKey, strings: string[]): boolean {
  const font = glyphFont(key);
  const fallback = glyphFont("arial"); // Liberation Sans, the registered fallback
  const seen = new Set<number>();
  for (const s of strings) {
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (seen.has(cp)) continue;
      seen.add(cp);
      if (cp <= 0x20 || (cp >= 0x7f && cp <= 0xa0) || cp === 0x200b) continue; // whitespace, controls
      if (!font.hasGlyphForCodePoint(cp) && !fallback.hasGlyphForCodePoint(cp)) return true;
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

type Ctx = { style: PageStyle };

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
                  <View style={{ flex: 1 }}>{blocks(li.content, ctx)}</View>
                </View>
              );
            })}
          </View>
        );
      }
      case "table":
        return (
          <View
            key={i}
            style={{
              marginBottom: ctx.style.spaceAfterPt,
              borderTopWidth: 0.5,
              borderLeftWidth: 0.5,
              borderColor: BORDER.borderColor,
            }}
          >
            {b.content.map((r, j) => (
              <View key={j} style={{ flexDirection: "row" }} wrap={false}>
                {r.content.map((c, k) => cell(c, k, ctx))}
              </View>
            ))}
          </View>
        );
      case "pageBreak":
        return <View key={i} break />;
    }
  });
}

function cell(c: ResolvedTableCell, key: number, ctx: Ctx) {
  return (
    <View
      key={key}
      style={{
        flex: 1,
        paddingLeft: CELL_PAD_PT,
        paddingRight: CELL_PAD_PT,
        borderRightWidth: 0.5,
        borderBottomWidth: 0.5,
        borderColor: BORDER.borderColor,
      }}
    >
      {blocks(c.content, { ...ctx, style: { ...ctx.style, spaceAfterPt: 0 } })}
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
  const ctx: Ctx = { style };

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

  const family = [FONTS[style.font].pdfFamily, FALLBACK_FAMILY];
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
