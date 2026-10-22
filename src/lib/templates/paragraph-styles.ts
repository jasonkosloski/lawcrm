/**
 * Named paragraph styles: the model, validation and built-in defaults.
 *
 * Firms define these in Settings → Documents; each style spells out every
 * value (no inheritance). Pure module, safe to import anywhere.
 */

import { z } from "zod";
import { headingSizePt, LINE_SPACINGS, type LineSpacing } from "./style-basics";
import type { TextAlign } from "./schema";

export type LineSpacingValue = LineSpacing | { exactPt: number };

export type FirstLine =
  { kind: "none" } | { kind: "indent"; in: number } | { kind: "hanging"; in: number };

export type StyleValues = {
  sizePt: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  smallCaps: boolean;
  allCaps: boolean;
  align: TextAlign;
  indentLeftIn: number;
  indentRightIn: number;
  firstLine: FirstLine;
  spaceBeforePt: number;
  spaceAfterPt: number;
  lineSpacing: LineSpacingValue;
  keepWithNext: boolean;
  keepLinesTogether: boolean;
  pageBreakBefore: boolean;
};

export type ParagraphStyle = {
  key: string;
  name: string;
  builtIn: boolean;
  values: StyleValues;
};

/** Keys of the built-in styles: always present, editable, never deletable. */
export const BUILT_IN_KEYS = [
  "body",
  "title",
  "heading1",
  "heading2",
  "heading3",
  "caption",
  "blockquote",
  "signature",
] as const;

export const MAX_PARAGRAPH_STYLES = 50;

const isMultipleOf = (n: number, step: number) => Math.abs(n / step - Math.round(n / step)) < 1e-9;

const sizePt = z
  .number()
  .min(8, "Size must be between 8 and 72 pt.")
  .max(72, "Size must be between 8 and 72 pt.")
  .refine((n) => isMultipleOf(n, 0.5), "Size must be in steps of 0.5 pt.");

const inches = z
  .number()
  .min(0, "Indents must be between 0 and 4 inches.")
  .max(4, "Indents must be between 0 and 4 inches.")
  .refine((n) => isMultipleOf(n, 0.01), "Indents can have at most 2 decimals.");

const spacePt = z
  .number()
  .min(0, "Spacing must be between 0 and 72 pt.")
  .max(72, "Spacing must be between 0 and 72 pt.");

const firstLine = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("indent"), in: inches }),
  z.object({ kind: z.literal("hanging"), in: inches }),
]);

const lineSpacing = z.union([
  z.enum(LINE_SPACINGS),
  z.object({
    exactPt: z
      .number()
      .min(6, "Exact line spacing must be between 6 and 144 pt.")
      .max(144, "Exact line spacing must be between 6 and 144 pt."),
  }),
]);

/** Every value of a style. */
export const styleValuesSchema = z.object({
  sizePt,
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  smallCaps: z.boolean(),
  allCaps: z.boolean(),
  align: z.enum(["left", "center", "right", "justify"]),
  indentLeftIn: inches,
  indentRightIn: inches,
  firstLine,
  spaceBeforePt: spacePt,
  spaceAfterPt: spacePt,
  lineSpacing,
  keepWithNext: z.boolean(),
  keepLinesTogether: z.boolean(),
  pageBreakBefore: z.boolean(),
});

/** A sparse set of values (court overrides). */
export const styleOverrideSchema = styleValuesSchema.partial();

const styleSchema = z.object({
  key: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1, "Style names need 1 to 60 characters.")
    .max(60, "Style names need 1 to 60 characters."),
  builtIn: z.boolean(),
  values: styleValuesSchema,
});

/** The firm's whole list: ≤ 50, unique keys and names, all built-ins present. */
export const paragraphStylesSchema = z
  .array(styleSchema)
  .max(MAX_PARAGRAPH_STYLES, `A firm can have at most ${MAX_PARAGRAPH_STYLES} styles.`)
  .superRefine((list, ctx) => {
    const keys = new Set<string>();
    const names = new Set<string>();
    for (const s of list) {
      if (keys.has(s.key))
        ctx.addIssue({ code: "custom", message: `Duplicate style key "${s.key}".` });
      keys.add(s.key);
      const lower = s.name.toLowerCase();
      if (names.has(lower))
        ctx.addIssue({ code: "custom", message: `Duplicate style name "${s.name}".` });
      names.add(lower);
      const isBuiltInKey = (BUILT_IN_KEYS as readonly string[]).includes(s.key);
      if (isBuiltInKey !== s.builtIn) {
        ctx.addIssue({ code: "custom", message: `Style "${s.key}" has the wrong built-in flag.` });
      }
    }
    for (const k of BUILT_IN_KEYS) {
      if (!keys.has(k)) ctx.addIssue({ code: "custom", message: `Missing built-in style "${k}".` });
    }
  });

type House = { fontSizeHalfPt: number; lineSpacing: LineSpacing; spaceAfterPt: number };

/** The built-in styles, derived from the firm's current house style. */
export function defaultParagraphStyles(house: House): ParagraphStyle[] {
  const size = house.fontSizeHalfPt / 2;
  const base: StyleValues = {
    sizePt: size,
    bold: false,
    italic: false,
    underline: false,
    smallCaps: false,
    allCaps: false,
    align: "left",
    indentLeftIn: 0,
    indentRightIn: 0,
    firstLine: { kind: "none" },
    spaceBeforePt: 0,
    spaceAfterPt: house.spaceAfterPt,
    lineSpacing: house.lineSpacing,
    keepWithNext: false,
    keepLinesTogether: false,
    pageBreakBefore: false,
  };
  const heading = (level: 1 | 2 | 3): StyleValues => ({
    ...base,
    bold: true,
    sizePt: headingSizePt(size, level),
    keepWithNext: true,
  });
  const style = (key: string, name: string, values: StyleValues): ParagraphStyle => ({
    key,
    name,
    builtIn: true,
    values,
  });
  return [
    style("body", "Body", base),
    style("title", "Title", { ...base, bold: true, allCaps: true, align: "center" }),
    style("heading1", "Heading 1", heading(1)),
    style("heading2", "Heading 2", heading(2)),
    style("heading3", "Heading 3", heading(3)),
    style("caption", "Caption", { ...base, spaceAfterPt: 0 }),
    style("blockquote", "Block quote", {
      ...base,
      lineSpacing: "single",
      indentLeftIn: 0.5,
      indentRightIn: 0.5,
    }),
    style("signature", "Signature", { ...base, spaceAfterPt: 0, keepLinesTogether: true }),
  ];
}

/** Reads the stored list defensively: anything invalid falls back to the defaults. */
export function parseParagraphStyles(json: unknown, house: House): ParagraphStyle[] {
  // NULL is the normal "not customised yet" state: defaults, no warning.
  if (json === null || json === undefined) return defaultParagraphStyles(house);
  const parsed = paragraphStylesSchema.safeParse(json);
  if (parsed.success) return parsed.data as ParagraphStyle[];
  console.warn("Invalid paragraphStyles; using defaults.", parsed.error.issues[0]?.message);
  return defaultParagraphStyles(house);
}

/** A lowercase slug of the name, suffixed -2, -3... until it is free (never a built-in key). */
export function newStyleKey(name: string, taken: Set<string>): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "style";
  const isFree = (k: string) => !taken.has(k) && !(BUILT_IN_KEYS as readonly string[]).includes(k);
  if (isFree(slug)) return slug;
  for (let n = 2; ; n++) {
    const candidate = `${slug}-${n}`;
    if (isFree(candidate)) return candidate;
  }
}
