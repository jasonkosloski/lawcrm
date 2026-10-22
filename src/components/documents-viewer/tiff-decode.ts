/**
 * TIFF page decoding (UTIF.js), shared by the decode worker
 * (tiff-decode.worker.ts) and its tests. Emits one message per event so
 * the worker can stream pages to TiffViewer as they decode; see the
 * worker for the message protocol.
 */

import { decode, decodeImage, toRGBA8, type IFD } from "utif";

export type TiffMessage =
  | { type: "count"; pages: number; shown: number }
  | { type: "page"; index: number; width: number; height: number; rgba: Uint8ClampedArray }
  | { type: "page-error"; index: number }
  | { type: "done" }
  | { type: "error" };

const dims = (ifd: IFD): [number, number] => [ifd.t256?.[0] ?? 0, ifd.t257?.[0] ?? 0];

export function decodeTiffPages(
  buffer: ArrayBuffer,
  opts: { maxPages: number; maxPixels: number },
  emit: (msg: TiffMessage) => void,
): void {
  let ifds: IFD[];
  try {
    // Real pages only: IFDs with dimensions (EXIF/GPS blocks without
    // image data are skipped).
    ifds = decode(buffer).filter((ifd) => {
      const [w, h] = dims(ifd);
      return w > 0 && h > 0;
    });
  } catch {
    emit({ type: "error" });
    return;
  }
  if (ifds.length === 0) {
    emit({ type: "error" });
    return;
  }
  const shown = Math.min(ifds.length, opts.maxPages);
  emit({ type: "count", pages: ifds.length, shown });
  for (let i = 0; i < shown; i++) {
    const [w, h] = dims(ifds[i]);
    if (w * h > opts.maxPixels) {
      emit({ type: "page-error", index: i });
      continue;
    }
    try {
      decodeImage(buffer, ifds[i], ifds);
      const rgba = toRGBA8(ifds[i]);
      const width = ifds[i].width ?? w;
      const height = ifds[i].height ?? h;
      emit({
        type: "page",
        index: i,
        width,
        height,
        rgba: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4),
      });
    } catch {
      emit({ type: "page-error", index: i });
    }
  }
  emit({ type: "done" });
}
