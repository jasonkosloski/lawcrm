/** Pixel size of a PNG or JPEG from its header bytes; null if unreadable. */
export function imageSize(
  bytes: Uint8Array,
  contentType: "image/png" | "image/jpeg",
): { width: number; height: number } | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (contentType === "image/png") {
    // 8-byte signature, then IHDR: length(4) "IHDR"(4) width(4) height(4).
    if (bytes.length < 24 || v.getUint32(0) !== 0x89504e47 || v.getUint32(12) !== 0x49484452) {
      return null;
    }
    const width = v.getUint32(16);
    const height = v.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (bytes.length < 4 || v.getUint16(0) !== 0xffd8) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = v.getUint16(i + 2);
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 9 > bytes.length) return null;
      const height = v.getUint16(i + 5);
      const width = v.getUint16(i + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}
