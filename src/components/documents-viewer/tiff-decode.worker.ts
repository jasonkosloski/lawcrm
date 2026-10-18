/**
 * TIFF decode worker for TiffViewer. Runs UTIF.js off the main
 * thread: a malformed TIFF from a production (e.g. an IFD chain that
 * loops) can spin forever, and in a worker the viewer just
 * terminates it on a timeout instead of hanging the tab.
 *
 * Protocol: post { buffer, maxPages, maxPixels } (buffer transferred).
 * Replies, in order:
 *   { type: "count", pages, shown }
 *   { type: "page", index, width, height, rgba } per page (transferred);
 *     a page over maxPixels or that fails to decode → { type: "page-error", index }
 *   { type: "done" }    or    { type: "error" } if the file isn't a TIFF
 */

import { decodeTiffPages } from "./tiff-decode";

type Request = { buffer: ArrayBuffer; maxPages: number; maxPixels: number };

self.onmessage = (e: MessageEvent<Request>) => {
  const { buffer, maxPages, maxPixels } = e.data;
  decodeTiffPages(buffer, { maxPages, maxPixels }, (msg) => {
    if (msg.type === "page") {
      // Hand the pixels over without copying.
      (self as unknown as Worker).postMessage(msg, [msg.rgba.buffer]);
    } else {
      self.postMessage(msg);
    }
  });
};
