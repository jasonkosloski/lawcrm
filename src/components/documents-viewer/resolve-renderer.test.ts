/**
 * contentType × extension matrix for the viewer's renderer switch.
 * Pure function — this test pins the exact routing so a change to
 * the matrix (or to the download route's inline allowlist that the
 * image/video/audio renderers depend on) is a deliberate,
 * test-updating act.
 */

import { describe, expect, test } from "vitest";
import { resolveDocumentRenderer } from "./resolve-renderer";

describe("resolveDocumentRenderer — by content type", () => {
  const cases: Array<[string, string]> = [
    ["application/pdf", "pdf"],
    ["image/png", "image"],
    ["image/jpeg", "image"],
    ["image/gif", "image"],
    ["image/webp", "image"],
    ["video/mp4", "video"],
    ["video/webm", "video"],
    ["video/quicktime", "video"],
    ["audio/mpeg", "audio"],
    ["audio/mp4", "audio"],
    ["audio/wav", "audio"],
    ["audio/webm", "audio"],
    ["audio/ogg", "audio"],
    ["text/plain", "text"],
    ["text/csv", "csv"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
    ["application/msword", "doc_legacy"],
  ];
  test.each(cases)("%s → %s", (contentType, expected) => {
    // Extension-less name so the content type alone must decide.
    expect(resolveDocumentRenderer(contentType, "file")).toBe(expected);
  });

  test("content type is normalized — case + parameters ignored", () => {
    expect(resolveDocumentRenderer("Application/PDF", "file")).toBe("pdf");
    expect(resolveDocumentRenderer("text/csv; charset=utf-8", "file")).toBe("csv");
    expect(resolveDocumentRenderer("VIDEO/MP4; codecs=avc1", "x")).toBe("video");
  });

  test("other text/* subtypes render as plain text (escaped pre)", () => {
    expect(resolveDocumentRenderer("text/markdown", "notes.md")).toBe("text");
    expect(resolveDocumentRenderer("text/html", "page.html")).toBe("text");
  });

  test("active-content types never map to an inline renderer", () => {
    // These would be XSS if they ever reached an iframe/img inline.
    expect(resolveDocumentRenderer("image/svg+xml", "file")).toBe("unsupported");
    expect(resolveDocumentRenderer("application/xhtml+xml", "file")).toBe("unsupported");
  });
});

describe("resolveDocumentRenderer — extension fallback", () => {
  const cases: Array<[string, string]> = [
    ["photo.JPG", "image"],
    ["photo.jpeg", "image"],
    ["frame.png", "image"],
    ["anim.gif", "image"],
    ["shot.webp", "image"],
    ["bodycam.mp4", "video"],
    ["bodycam.MOV", "video"],
    ["clip.webm", "video"], // ambiguous ext — video wins
    ["clip.m4v", "video"],
    ["911-call.mp3", "audio"],
    ["interview.m4a", "audio"],
    ["dispatch.wav", "audio"],
    ["dispatch.ogg", "audio"],
    ["notes.txt", "text"],
    ["server.log", "text"],
    ["readme.md", "text"],
    ["phone-records.csv", "csv"],
    ["demand-letter.docx", "docx"],
    ["old-pleading.doc", "doc_legacy"],
    ["phone-bill.XLSX", "spreadsheet"],
    ["client-email.eml", "eml"],
    ["outlook-export.msg", "msg"],
    ["scan.tif", "tiff"],
    ["production.TIFF", "tiff"],
    ["IMG_0042.HEIC", "heic"],
    ["IMG_0043.heif", "heic"],
    ["scan.pdf", "pdf"],
  ];
  test.each(cases)("null type + %s → %s", (name, expected) => {
    expect(resolveDocumentRenderer(null, name)).toBe(expected);
  });

  test("generic octet-stream defers to the extension", () => {
    expect(resolveDocumentRenderer("application/octet-stream", "dispatch.mp3")).toBe("audio");
    expect(resolveDocumentRenderer("application/octet-stream", "scene.jpg")).toBe("image");
  });

  test("unrecognized type falls through to the extension", () => {
    // Uploaders sometimes declare vendor-specific types; the
    // extension is the better signal then.
    expect(resolveDocumentRenderer("application/x-wav", "call.wav")).toBe("audio");
  });

  test("typeless / mistyped PDFs preview too — pdf.js fetches the bytes itself", () => {
    // The download route still serves these as attachments, but the
    // built-in viewer fetches the bytes, so disposition doesn't matter
    // (was F999's download-card rule in the iframe era).
    expect(resolveDocumentRenderer(null, "scan.pdf")).toBe("pdf");
    expect(resolveDocumentRenderer("application/octet-stream", "scan.pdf")).toBe("pdf");
    expect(resolveDocumentRenderer("application/x-pdf", "scan.pdf")).toBe("pdf");
  });

  test("the new types resolve from their MIME types", () => {
    expect(
      resolveDocumentRenderer(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "x",
      ),
    ).toBe("spreadsheet");
    expect(resolveDocumentRenderer("message/rfc822", "x")).toBe("eml");
    expect(resolveDocumentRenderer("application/vnd.ms-outlook", "x")).toBe("msg");
    expect(resolveDocumentRenderer("image/tiff", "x")).toBe("tiff");
    expect(resolveDocumentRenderer("image/heic", "x")).toBe("heic");
    // Legacy .xls stays a download card.
    expect(resolveDocumentRenderer("application/vnd.ms-excel", "old.xls")).toBe("unsupported");
  });

  test("known content type wins over a contradicting extension", () => {
    expect(resolveDocumentRenderer("application/pdf", "misnamed.mp3")).toBe("pdf");
  });
});

describe("resolveDocumentRenderer — unsupported", () => {
  test("no type, no useful extension", () => {
    expect(resolveDocumentRenderer(null, "archive.zip")).toBe("unsupported");
    expect(resolveDocumentRenderer(null, "no-extension")).toBe("unsupported");
    expect(resolveDocumentRenderer(null, ".hidden")).toBe("unsupported");
    expect(resolveDocumentRenderer(null, "trailing-dot.")).toBe("unsupported");
  });

  test("legacy spreadsheets / archives / slides are download-only", () => {
    expect(resolveDocumentRenderer("application/vnd.ms-excel", "billing.xls")).toBe("unsupported");
    expect(resolveDocumentRenderer(null, "deck.pptx")).toBe("unsupported");
    expect(resolveDocumentRenderer("application/zip", "production.zip")).toBe("unsupported");
  });
});
