// Minimal types for `fontkit` (ships none) — only what the PDF converter
// uses to test glyph coverage and measure text.
declare module "fontkit" {
  export type Font = {
    hasGlyphForCodePoint(codePoint: number): boolean;
    ascent: number;
    descent: number;
    lineGap: number;
    unitsPerEm: number;
    layout(text: string): { advanceWidth: number };
  };
  export function openSync(path: string): Font;
}
