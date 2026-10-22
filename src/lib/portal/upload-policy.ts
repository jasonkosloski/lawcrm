/**
 * What a portal client may upload. Client-safe (no server imports): the
 * portal uploader pre-checks with the same function the token route and
 * the completion step enforce.
 *
 * Only the LAST extension counts and it must be on the allowlist, so
 * `report.pdf.exe` is an .exe. The content type is derived from the
 * extension (`contentTypeForFilename`); a browser-declared MIME is ignored.
 * Size caps match the staff uploader.
 */

import {
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_STANDARD_UPLOAD_BYTES,
  contentTypeForFilename,
  isMediaType,
} from "@/app/api/documents/upload/upload-config";

export const PORTAL_UPLOAD_EXTENSIONS: readonly string[] = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "jpg",
  "jpeg",
  "png",
  "heic",
  "heif",
  "webp",
  "gif",
  "tif",
  "tiff",
  "mp3",
  "m4a",
  "wav",
  "mp4",
  "mov",
  "txt",
  "rtf",
];

/** Uploads per portal identity per rolling 24 hours. */
export const PORTAL_DAILY_UPLOAD_CAP = 100;

const SEND_INSTEAD = "Please send PDFs, photos or Office documents.";

export type PortalUploadCheck =
  { ok: true; contentType: string; maxBytes: number } | { ok: false; error: string };

export function checkPortalUpload(filename: string): PortalUploadCheck {
  const name = filename.trim();
  const dot = name.lastIndexOf(".");
  // No extension, a dotfile (".pdf") or a trailing dot.
  if (dot <= 0 || dot === name.length - 1) {
    return { ok: false, error: `We can't accept this file. ${SEND_INSTEAD}` };
  }
  const ext = name.slice(dot + 1).toLowerCase();
  if (!PORTAL_UPLOAD_EXTENSIONS.includes(ext)) {
    return { ok: false, error: `We can't accept .${ext} files. ${SEND_INSTEAD}` };
  }
  const contentType = contentTypeForFilename(name);
  return {
    ok: true,
    contentType,
    maxBytes: isMediaType(contentType) ? MAX_MEDIA_UPLOAD_BYTES : MAX_STANDARD_UPLOAD_BYTES,
  };
}
