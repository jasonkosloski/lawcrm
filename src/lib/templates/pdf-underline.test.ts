/**
 * patches/@react-pdf+textkit: react-pdf's underline uses the font's own
 * position and thickness, not a fixed offset that covers descenders.
 * Fails if a react-pdf upgrade drops the patch.
 */
import { describe, expect, it } from "vitest";
import { openSync } from "fontkit";
import { textDecoration } from "@react-pdf/textkit";
import { fontFilePath } from "./fonts-server";

describe("PDF underline (patched react-pdf)", () => {
  it("sits at the font's underline position with the font's thickness", () => {
    const font = openSync(fontFilePath("LiberationSerif-Regular.ttf")) as unknown as {
      unitsPerEm: number;
      underlinePosition: number;
      underlineThickness: number;
      ascent: number;
    };
    const fontSize = 24;
    const scale = fontSize / font.unitsPerEm;
    const run = {
      start: 0,
      end: 5,
      attributes: { font: [font], fontSize, underline: true },
      glyphs: [],
      positions: [{ xAdvance: 100 }],
    };
    const line = { string: "gjpqy", runs: [run] };
    const out = textDecoration()(line as never) as unknown as {
      decorationLines: { rect: { y: number; height: number } }[];
    };
    const { rect } = out.decorationLines[0];
    const thickness = font.underlineThickness * scale;
    expect(rect.height).toBeCloseTo(thickness, 3);
    // Below the baseline (line ascent) by the font's underline position.
    const baseline = font.ascent * scale;
    expect(rect.y - baseline).toBeCloseTo(-font.underlinePosition * scale + thickness / 2, 3);
    // Well above react-pdf's own offset at 24pt (4pt down: on the descender tips).
    expect(rect.y - baseline).toBeLessThan(3);
  });
});
