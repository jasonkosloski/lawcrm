import { describe, expect, it } from "vitest";
import { imageSize } from "./image-size";

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x89504e47);
  v.setUint32(4, 0x0d0a1a0a);
  v.setUint32(8, 13);
  v.setUint32(12, 0x49484452);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return b;
};

const jpeg = (w: number, h: number) =>
  Uint8Array.from([
    0xff,
    0xd8,
    // APP0 segment (length 4: two payload bytes)
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    // SOF0
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    h >> 8,
    h & 255,
    w >> 8,
    w & 255,
    0x03,
  ]);

describe("imageSize", () => {
  it("reads PNG IHDR", () => {
    expect(imageSize(png(300, 120), "image/png")).toEqual({ width: 300, height: 120 });
  });
  it("reads JPEG SOF past other segments", () => {
    expect(imageSize(jpeg(640, 200), "image/jpeg")).toEqual({ width: 640, height: 200 });
  });
  it("returns null for garbage or truncated input", () => {
    expect(imageSize(new Uint8Array([1, 2, 3]), "image/png")).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).toBeNull();
    expect(imageSize(png(0, 5), "image/png")).toBeNull();
  });
});
