/**
 * TIFF decoding against a hand-built, uncompressed 2-page RGB TIFF:
 * page count, pixel data, the page and pixel caps, and garbage input
 * (an error message, never a throw).
 */

import { describe, expect, test } from "vitest";
import { decodeTiffPages, type TiffMessage } from "./tiff-decode";

/** Little-endian, uncompressed RGB, one strip per page. */
function tiff(pages: { w: number; h: number; rgb: number[] }[]): ArrayBuffer {
  const parts: number[] = [];
  const u16 = (n: number) => parts.push(n & 255, (n >> 8) & 255);
  const u32 = (n: number) => parts.push(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255);
  // Header; first IFD offset patched below.
  parts.push(0x49, 0x49);
  u16(42);
  u32(8);
  const entries = 9;
  const ifdSize = 2 + entries * 12 + 4;
  let offset = 8;
  // Layout: [IFD][bitsPerSample x3][pixels] per page.
  pages.forEach((p, i) => {
    const bpsAt = offset + ifdSize;
    const dataAt = bpsAt + 6;
    const next = i < pages.length - 1 ? dataAt + p.rgb.length : 0;
    const tag = (t: number, type: number, count: number, value: number) => {
      u16(t);
      u16(type);
      u32(count);
      if (type === 3 && count === 1) {
        u16(value);
        u16(0);
      } else u32(value);
    };
    u16(entries);
    tag(256, 3, 1, p.w); // width
    tag(257, 3, 1, p.h); // height
    tag(258, 3, 3, bpsAt); // bits per sample → offset
    tag(259, 3, 1, 1); // no compression
    tag(262, 3, 1, 2); // RGB
    tag(273, 4, 1, dataAt); // strip offset
    tag(277, 3, 1, 3); // samples per pixel
    tag(278, 3, 1, p.h); // rows per strip
    tag(279, 4, 1, p.rgb.length); // strip byte count
    u32(next);
    u16(8);
    u16(8);
    u16(8);
    parts.push(...p.rgb);
    offset = next;
  });
  return new Uint8Array(parts).buffer;
}

const RED_GREEN = { w: 2, h: 1, rgb: [255, 0, 0, 0, 255, 0] };
const BLUE = { w: 1, h: 1, rgb: [0, 0, 255] };

function run(buffer: ArrayBuffer, opts = { maxPages: 10, maxPixels: 1_000_000 }) {
  const out: TiffMessage[] = [];
  decodeTiffPages(buffer, opts, (m) => out.push(m));
  return out;
}

describe("decodeTiffPages", () => {
  test("decodes every page to RGBA, in order", () => {
    const msgs = run(tiff([RED_GREEN, BLUE]));
    expect(msgs[0]).toEqual({ type: "count", pages: 2, shown: 2 });
    const pages = msgs.filter((m) => m.type === "page");
    expect(pages).toHaveLength(2);
    const [p1, p2] = pages as Extract<TiffMessage, { type: "page" }>[];
    expect([p1.width, p1.height]).toEqual([2, 1]);
    expect(Array.from(p1.rgba)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    expect(Array.from(p2.rgba)).toEqual([0, 0, 255, 255]);
    expect(msgs.at(-1)).toEqual({ type: "done" });
  });

  test("the page cap limits what's decoded but reports the true count", () => {
    const msgs = run(tiff([RED_GREEN, BLUE]), { maxPages: 1, maxPixels: 1_000_000 });
    expect(msgs[0]).toEqual({ type: "count", pages: 2, shown: 1 });
    expect(msgs.filter((m) => m.type === "page")).toHaveLength(1);
  });

  test("a page over the pixel cap is skipped, not decoded", () => {
    const msgs = run(tiff([RED_GREEN, BLUE]), { maxPages: 10, maxPixels: 1 });
    expect(msgs).toContainEqual({ type: "page-error", index: 0 });
    expect(msgs.filter((m) => m.type === "page")).toHaveLength(1);
  });

  test("not a TIFF → an error message, never a throw", () => {
    expect(run(new TextEncoder().encode("hello").buffer as ArrayBuffer)).toEqual([{ type: "error" }]);
  });
});
