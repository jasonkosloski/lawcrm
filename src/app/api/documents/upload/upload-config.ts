/**
 * Upload route configuration — size caps + server-side MIME
 * resolution.
 *
 * Separate module (not in route.ts) because Next type-checks route
 * files against the allowed-exports set, and because the tests mock
 * the caps down to bytes instead of allocating 100MiB fixtures.
 */

/** Per-file cap for video/audio. Discovery media (bodycam, depo
 *  recordings) runs to gigabytes. Nominally 2 GiB — minus one byte
 *  because `Document.fileSize` is a signed Int4 in Postgres and
 *  2^31 exactly would overflow the column. */
export const MAX_MEDIA_UPLOAD_BYTES = 2 * 1024 ** 3 - 1;

/** Per-file cap for everything that isn't audio/video. 100 MiB
 *  covers scanned productions and expert-report PDFs with room to
 *  spare; anything bigger is almost certainly media wearing the
 *  wrong extension. */
export const MAX_STANDARD_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Sanity ceiling on file parts per request — a discovery batch is
 *  dozens of files, not thousands. Busboy stops emitting past this. */
export const MAX_FILES_PER_BATCH = 100;

/**
 * Extension → MIME map, curated for what actually shows up in
 * discovery productions (Office docs, scans, bodycam/dashcam media,
 * call recordings, email exports, archives). This is the server's
 * source of truth for `Document.contentType`:
 *
 *   - The client-declared part MIME (`file.type`) is attacker
 *     controlled and is deliberately ignored — when it disagrees
 *     with the extension, the extension wins.
 *   - Unknown extension → application/octet-stream, which the
 *     download route serves as `attachment` (never inline).
 *
 * text/html and image/svg+xml appear here so the *label* is honest;
 * the download route's inline allowlist still forces both to
 * attachment + CSP sandbox (see ../[id]/download/route.ts).
 */
const EXTENSION_MIME: Record<string, string> = {
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  svg: "image/svg+xml",
  // Video
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  wmv: "video/x-ms-wmv",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  "3gp": "video/3gpp",
  // Audio
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  aac: "audio/aac",
  wma: "audio/x-ms-wma",
  amr: "audio/amr",
  // Email exports + archives
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  gz: "application/gzip",
  // Subtitles / transcripts riding along with media productions
  vtt: "text/vtt",
  srt: "application/x-subrip",
};

/** Server-resolved MIME for a filename — see EXTENSION_MIME. */
export function contentTypeForFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  // No extension, dotfile (".env"), or trailing dot → unknown.
  if (dot <= 0 || dot === filename.length - 1) {
    return "application/octet-stream";
  }
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXTENSION_MIME[ext] ?? "application/octet-stream";
}

/** Media (video/audio) gets the big cap; everything else the small. */
export function isMediaType(contentType: string): boolean {
  return (
    contentType.startsWith("video/") || contentType.startsWith("audio/")
  );
}
