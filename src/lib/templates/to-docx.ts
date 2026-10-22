/** ResolvedDoc -> .docx bytes, applying the firm's house PageStyle. */

import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import { FONTS } from "./fonts";
import { imageSize } from "./image-size";
import { headingSizePt, type LoadedLogo, type PageStyle } from "./page-style";
import type { ResolvedBlock, ResolvedDoc, ResolvedInline, ResolvedTableCell } from "./render";

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];

const BULLET_REF = "bullets";
const NUMBER_REF = "numbers";
const MAX_LEVEL = 8;

function runs(nodes: ResolvedInline[] | undefined): ParagraphChild[] {
  return (nodes ?? []).map((n) => {
    if (n.type === "hardBreak") return new TextRun({ break: 1 });
    const types = new Set((n.marks ?? []).map((m) => m.type));
    return new TextRun({
      text: n.text,
      bold: types.has("bold") || undefined,
      italics: types.has("italic") || undefined,
      underline: types.has("underline") ? {} : undefined,
      highlight: types.has("missing") ? "yellow" : undefined,
    });
  });
}

type Ctx = { instance: { n: number } };

function blocks(list: ResolvedBlock[], ctx: Ctx, level: number): (Paragraph | Table)[] {
  return list.flatMap((b): (Paragraph | Table)[] => {
    switch (b.type) {
      case "paragraph":
        return [
          new Paragraph({
            children: runs(b.content),
            alignment: b.attrs?.textAlign ? ALIGN[b.attrs.textAlign] : undefined,
          }),
        ];
      case "heading":
        return [
          new Paragraph({
            children: runs(b.content),
            heading: HEADINGS[b.attrs.level - 1],
            alignment: b.attrs.textAlign ? ALIGN[b.attrs.textAlign] : undefined,
          }),
        ];
      case "bulletList":
      case "orderedList": {
        const lvl = Math.min(level, MAX_LEVEL);
        // Each ordered list gets its own numbering instance so it restarts at 1.
        const instance = b.type === "orderedList" ? ++ctx.instance.n : 0;
        return b.content.flatMap((li) =>
          li.content.flatMap((c, i): (Paragraph | Table)[] => {
            if (c.type === "paragraph" || c.type === "heading") {
              return [
                new Paragraph({
                  children: runs(c.content),
                  alignment: c.attrs?.textAlign ? ALIGN[c.attrs.textAlign] : undefined,
                  // Only the first paragraph of an item carries the marker.
                  ...(i === 0
                    ? {
                        numbering: {
                          reference: b.type === "bulletList" ? BULLET_REF : NUMBER_REF,
                          level: lvl,
                          instance,
                        },
                      }
                    : { indent: { left: 720 * (lvl + 1) } }),
                }),
              ];
            }
            return blocks([c], ctx, lvl + 1);
          }),
        );
      }
      case "table":
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: b.content.map(
              (r) => new TableRow({ children: r.content.map((c) => tableCell(c, ctx)) }),
            ),
          }),
        ];
      case "pageBreak":
        return [new Paragraph({ children: [new PageBreak()] })];
    }
  });
}

function tableCell(c: ResolvedTableCell, ctx: Ctx): TableCell {
  const children = blocks(c.content, ctx, 0);
  // Word requires at least one paragraph per cell.
  return new TableCell({ children: children.length ? children : [new Paragraph("")] });
}

const levels = (format: (typeof LevelFormat)[keyof typeof LevelFormat], bullet: boolean) =>
  Array.from({ length: MAX_LEVEL + 1 }, (_, level) => ({
    level,
    format,
    text: bullet ? "•" : `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));

const EMU_PER_IN = 96; // docx ImageRun transformation is in pixels at 96 dpi
const LOGO_MAX_W_IN = 3;
const LOGO_MAX_H_IN = 1;

function logoParagraph(logo: LoadedLogo): Paragraph {
  const size = imageSize(logo.bytes, logo.contentType);
  let wIn = 1;
  let hIn = 1;
  if (size) {
    const scale = Math.min(LOGO_MAX_W_IN / size.width, LOGO_MAX_H_IN / size.height);
    wIn = size.width * scale;
    hIn = size.height * scale;
  }
  return new Paragraph({
    alignment: ALIGN[logo.position],
    children: [
      new ImageRun({
        type: logo.contentType === "image/png" ? "png" : "jpg",
        data: logo.bytes,
        transformation: {
          width: Math.round(wIn * EMU_PER_IN),
          height: Math.round(hIn * EMU_PER_IN),
        },
      }),
    ],
  });
}

const pageLine = (alignment: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
  new Paragraph({
    alignment,
    children: [new TextRun({ children: ["Page ", PageNumber.CURRENT] })],
  });

const content = (doc: ResolvedDoc | null, ctx: Ctx): (Paragraph | Table)[] =>
  doc ? blocks(doc.content ?? [], ctx, 0) : [];

export async function resolvedToDocx(input: {
  body: ResolvedDoc;
  letterhead: ResolvedDoc | null;
  continuation: ResolvedDoc | null;
  style: PageStyle;
}): Promise<Buffer> {
  const { style } = input;
  const ctx: Ctx = { instance: { n: 0 } };
  const children = blocks(input.body.content ?? [], ctx, 0);
  const isLetter = style.letterhead !== null || style.continuationBlockId !== null;
  const font = FONTS[style.font].wordName;
  const headingRun = (level: 1 | 2 | 3) => ({
    font,
    bold: true,
    size: headingSizePt(style.sizePt, level) * 2,
  });
  const headingPara = {
    spacing: {
      after: style.spaceAfterPt * 20,
      line: Math.round(240 * style.lineSpacing),
      lineRule: "auto" as const,
    },
  };

  const headers: { first?: Header; default?: Header } = {};
  if (style.letterhead) {
    const parts: (Paragraph | Table)[] = [];
    if (style.letterhead.logo) parts.push(logoParagraph(style.letterhead.logo));
    parts.push(...content(input.letterhead, ctx));
    if (parts.length) headers.first = new Header({ children: parts });
  }
  if (isLetter) {
    headers.default = new Header({
      children: [...content(input.continuation, ctx), pageLine(AlignmentType.RIGHT)],
    });
  }

  const footers: { default?: Footer; first?: Footer } = {};
  if (style.pageNumbers !== "none") {
    footers.default = new Footer({
      children: [
        pageLine(style.pageNumbers === "bottom_right" ? AlignmentType.RIGHT : AlignmentType.CENTER),
      ],
    });
    // First page of letters carries no page number.
    if (isLetter) footers.first = new Footer({ children: [new Paragraph("")] });
  }

  const file = new Document({
    styles: {
      default: {
        document: {
          run: { font, size: style.sizePt * 2 },
          paragraph: {
            spacing: {
              after: style.spaceAfterPt * 20,
              line: Math.round(240 * style.lineSpacing),
              lineRule: "auto",
            },
          },
        },
        heading1: { run: headingRun(1), paragraph: headingPara },
        heading2: { run: headingRun(2), paragraph: headingPara },
        heading3: { run: headingRun(3), paragraph: headingPara },
      },
    },
    numbering: {
      config: [
        { reference: BULLET_REF, levels: levels(LevelFormat.BULLET, true) },
        { reference: NUMBER_REF, levels: levels(LevelFormat.DECIMAL, false) },
      ],
    },
    sections: [
      {
        properties: {
          titlePage: isLetter || undefined,
          page: {
            size: { width: 12240, height: 15840 },
            margin: {
              top: Math.round(style.marginsIn.top * 1440),
              right: Math.round(style.marginsIn.right * 1440),
              bottom: Math.round(style.marginsIn.bottom * 1440),
              left: Math.round(style.marginsIn.left * 1440),
            },
          },
        },
        headers,
        footers,
        children: children.length ? children : [new Paragraph("")],
      },
    ],
  });
  return Packer.toBuffer(file);
}
