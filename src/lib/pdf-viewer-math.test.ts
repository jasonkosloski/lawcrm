import { describe, expect, test } from "vitest";
import {
  MAX_CANVAS_PIXELS,
  MAX_ZOOM,
  MIN_ZOOM,
  canvasOutputScale,
  fitWidthScale,
  pageAtOffset,
  parsePageJump,
  stepZoom,
} from "./pdf-viewer-math";

describe("stepZoom", () => {
  test("steps through the ladder and clamps at both ends", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  test("an off-ladder value snaps to the neighbour in the direction asked", () => {
    expect(stepZoom(1.2, 1)).toBe(1.25);
    expect(stepZoom(1.2, -1)).toBe(1.1);
  });
});

describe("fitWidthScale", () => {
  test("fills the width less the gutter", () => {
    // 644 px wide, 32 px gutter, a 612 pt (US Letter) page → 1.0
    expect(fitWidthScale(644, 612)).toBeCloseTo(1);
  });

  test("an unlaid-out container falls back to 1; tiny widths keep a floor", () => {
    expect(fitWidthScale(0, 612)).toBe(1);
    expect(fitWidthScale(40, 612)).toBe(0.25);
  });
});

describe("pageAtOffset", () => {
  const tops = [0, 800, 1600, 2400];

  test("the last page whose top is at or above the reading line", () => {
    expect(pageAtOffset(tops, 0)).toBe(1);
    expect(pageAtOffset(tops, 799)).toBe(1);
    expect(pageAtOffset(tops, 800)).toBe(2);
    expect(pageAtOffset(tops, 5000)).toBe(4);
  });

  test("above the first page / no pages → page 1", () => {
    expect(pageAtOffset(tops, -50)).toBe(1);
    expect(pageAtOffset([], 100)).toBe(1);
  });

  test("handles thousands of pages", () => {
    const many = Array.from({ length: 5000 }, (_, i) => i * 1000);
    expect(pageAtOffset(many, 4_321_500)).toBe(4322);
  });
});

describe("canvasOutputScale", () => {
  test("uses the screen's pixel ratio for normal pages", () => {
    expect(canvasOutputScale(800, 1000, 2)).toBe(2);
  });

  test("backs off at high zoom so the canvas stays under the browser cap", () => {
    const s = canvasOutputScale(3000, 4000, 2);
    expect(s).toBeLessThan(2);
    expect(3000 * s * 4000 * s).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1);
  });

  test("a bogus pixel ratio counts as 1", () => {
    expect(canvasOutputScale(100, 100, 0)).toBe(1);
  });
});

describe("parsePageJump", () => {
  test("whole numbers inside the document only", () => {
    expect(parsePageJump(" 12 ", 40)).toBe(12);
    expect(parsePageJump("0", 40)).toBeNull();
    expect(parsePageJump("41", 40)).toBeNull();
    expect(parsePageJump("3.5", 40)).toBeNull();
    expect(parsePageJump("", 40)).toBeNull();
  });
});
