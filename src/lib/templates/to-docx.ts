/** ResolvedDoc -> .docx bytes with Word defaults (no house style). */

import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
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

export async function resolvedToDocx(doc: ResolvedDoc): Promise<Buffer> {
  const ctx: Ctx = { instance: { n: 0 } };
  const children = blocks(doc.content ?? [], ctx, 0);
  const file = new Document({
    numbering: {
      config: [
        { reference: BULLET_REF, levels: levels(LevelFormat.BULLET, true) },
        { reference: NUMBER_REF, levels: levels(LevelFormat.DECIMAL, false) },
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph("")] }],
  });
  return Packer.toBuffer(file);
}
