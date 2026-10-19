import { describe, expect, test } from "vitest";

import {
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_STANDARD_UPLOAD_BYTES,
} from "@/app/api/documents/upload/upload-config";
import {
  PORTAL_DAILY_UPLOAD_CAP,
  PORTAL_UPLOAD_EXTENSIONS,
  checkPortalUpload,
} from "./upload-policy";

describe("checkPortalUpload", () => {
  test("every allowlisted extension passes with a real (non-octet) type", () => {
    for (const ext of PORTAL_UPLOAD_EXTENSIONS) {
      const r = checkPortalUpload(`file.${ext}`);
      expect(r.ok, ext).toBe(true);
      if (r.ok) expect(r.contentType, ext).not.toBe("application/octet-stream");
    }
  });

  test("the allowlist is exactly the approved set", () => {
    expect([...PORTAL_UPLOAD_EXTENSIONS].sort()).toEqual(
      [
        "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "jpg", "jpeg",
        "png", "heic", "heif", "webp", "gif", "tif", "tiff", "mp3", "m4a",
        "wav", "mp4", "mov", "txt", "rtf",
      ].sort()
    );
  });

  test("archive.zip fails with the exact rejection copy", () => {
    expect(checkPortalUpload("archive.zip")).toEqual({
      ok: false,
      error: "We can't accept .zip files. Please send PDFs, photos or Office documents.",
    });
  });

  test("only the LAST extension counts: report.pdf.exe fails", () => {
    expect(checkPortalUpload("report.pdf.exe")).toEqual({
      ok: false,
      error: "We can't accept .exe files. Please send PDFs, photos or Office documents.",
    });
  });

  test("no extension, dotfile and trailing dot fail", () => {
    for (const name of ["scan", ".pdf", "scan.", ""]) {
      const r = checkPortalUpload(name);
      expect(r.ok, name).toBe(false);
    }
  });

  test("case-insensitive: PHOTO.HEIC passes as image/heic", () => {
    expect(checkPortalUpload("PHOTO.HEIC")).toEqual({
      ok: true,
      contentType: "image/heic",
      maxBytes: MAX_STANDARD_UPLOAD_BYTES,
    });
  });

  test("heif resolves to image/heif", () => {
    const r = checkPortalUpload("x.heif");
    expect(r.ok && r.contentType).toBe("image/heif");
  });

  test("media gets the media cap, documents the standard cap", () => {
    const mov = checkPortalUpload("clip.MOV");
    expect(mov.ok && mov.maxBytes).toBe(MAX_MEDIA_UPLOAD_BYTES);
    const mp3 = checkPortalUpload("call.mp3");
    expect(mp3.ok && mp3.maxBytes).toBe(MAX_MEDIA_UPLOAD_BYTES);
    const pdf = checkPortalUpload("a.pdf");
    expect(pdf.ok && pdf.maxBytes).toBe(MAX_STANDARD_UPLOAD_BYTES);
  });

  test("rejection copy for an odd extension is lower-cased", () => {
    const r = checkPortalUpload("thing.SVG");
    expect(r).toEqual({
      ok: false,
      error: "We can't accept .svg files. Please send PDFs, photos or Office documents.",
    });
  });

  test("daily cap is 100", () => {
    expect(PORTAL_DAILY_UPLOAD_CAP).toBe(100);
  });
});
