// Minimal types for `utif` (UTIF.js ships none) — only what the TIFF
// viewer's decode worker uses.
declare module "utif" {
  export type IFD = {
    width?: number;
    height?: number;
    /** Tag 256 / 257 (image width / height) before decodeImage. */
    t256?: number[];
    t257?: number[];
    [tag: string]: unknown;
  };
  export function decode(buffer: ArrayBuffer | Uint8Array): IFD[];
  export function decodeImage(buffer: ArrayBuffer | Uint8Array, ifd: IFD, ifds?: IFD[]): void;
  export function toRGBA8(ifd: IFD): Uint8Array;
}
