/**
 * Renderer selection for the document viewer — a pure function so
 * the contentType × extension matrix is unit-testable without
 * rendering anything.
 *
 * Selection order:
 *   1. The stored `Document.contentType` (uploader's client-declared
 *      MIME type, normalized to the bare lowercase media type — a
 *      stored "Video/MP4; codecs=..." still matches).
 *   2. Filename-extension fallback when the content type is missing,
 *      generic (octet-stream), or unrecognized — scanners and ECF
 *      downloads frequently arrive typeless.
 *   3. `unsupported` → the download-CTA fallback card.
 *
 * The browser-native renderers (image / video / audio) lean on the
 * download route's INLINE_SAFE_TYPES allowlist
 * (`src/app/api/documents/[id]/download/route.ts`) — keep the two
 * lists in the same universe. Everything else never depends on the
 * route's disposition: pdf / docx / tiff / heic are fetched and
 * decoded by our own client code (pdf.js, docx-preview, utif,
 * heic-to), and text / csv / spreadsheet / eml / msg are read and
 * converted server-side by the page. Those can therefore resolve
 * from the extension as well as the stored type.
 */

export type DocumentRenderer =
  | "pdf"
  | "image"
  | "video"
  | "audio"
  | "text"
  | "csv"
  | "docx"
  | "spreadsheet"
  | "eml"
  | "msg"
  | "tiff"
  | "heic"
  | "doc_legacy"
  | "unsupported";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Bare media type → renderer. */
const TYPE_MAP: Record<string, DocumentRenderer> = {
  "application/pdf": "pdf",
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/webm": "audio",
  "audio/ogg": "audio",
  "text/csv": "csv",
  [DOCX_TYPE]: "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "spreadsheet",
  "message/rfc822": "eml",
  "application/vnd.ms-outlook": "msg",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/heif": "heic",
  "application/msword": "doc_legacy",
};

/** Lowercased extension (no dot) → renderer, for typeless uploads.
 *
 *  NO `pdf` entry on purpose: the PDF renderer iframes the download
 *  route, which decides inline vs attachment from the STORED content
 *  type (`isInlineSafeType`). A typeless / octet-stream / x-pdf row
 *  is served as an attachment, so an extension-based "pdf" verdict
 *  would make the iframe trigger a file download (again on every
 *  page-flag jump) instead of previewing. Those rows get the
 *  download card until their stored type is corrected. Media and
 *  image elements ignore Content-Disposition, so their extension
 *  fallbacks stay. */
const EXTENSION_MAP: Record<string, DocumentRenderer> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  mp4: "video",
  m4v: "video",
  webm: "video", // ambiguous with audio — video wins (bodycam > podcast)
  mov: "video",
  mp3: "audio",
  m4a: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  txt: "text",
  text: "text",
  log: "text",
  md: "text",
  csv: "csv",
  docx: "docx",
  pdf: "pdf",
  xlsx: "spreadsheet",
  eml: "eml",
  msg: "msg",
  tif: "tiff",
  tiff: "tiff",
  heic: "heic",
  heif: "heic",
  doc: "doc_legacy",
};

/** "Text/Plain; charset=utf-8" → "text/plain". */
function bareMediaType(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

function extensionOf(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * Pick the viewer renderer for a document.
 *
 * @param contentType stored MIME type (nullable — old rows and
 *   typeless uploads)
 * @param fileName the document's display name (usually the original
 *   filename, so its extension is meaningful)
 */
export function resolveDocumentRenderer(
  contentType: string | null,
  fileName: string,
): DocumentRenderer {
  if (contentType) {
    const bare = bareMediaType(contentType);
    const byType = TYPE_MAP[bare];
    if (byType) return byType;
    // Any other text/* renders fine in the escaped <pre> preview
    // (server-side read; nothing is interpreted as markup). csv is
    // matched above; markdown lands here and shows as source.
    if (bare.startsWith("text/")) return "text";
    // Recognized-but-unmapped type (e.g. application/zip): fall
    // through to the extension in case the type is just generic.
  }
  const ext = extensionOf(fileName);
  if (ext) {
    const byExt = EXTENSION_MAP[ext];
    if (byExt) return byExt;
  }
  return "unsupported";
}
