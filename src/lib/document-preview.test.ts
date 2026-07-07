/**
 * Tests for the document-viewer preview pipelines.
 *
 * Honesty notes on what's real vs mocked:
 *  - mammoth is REAL — .docx fixtures are assembled in-memory with
 *    jszip (mammoth's own dependency, so the zip flavor matches what
 *    it can read) and run through the actual converter. The
 *    sanitize-integration test plants a `javascript:` hyperlink
 *    inside a genuine OOXML relationship and asserts the pipeline
 *    strips it — end-to-end, no mocked HTML.
 *  - the storage adapter (`@/lib/file-storage`) IS mocked with an
 *    in-memory byte map: these are unit tests and must not touch
 *    the uploads/ directory. The mock honors ranged reads the same
 *    way `fs.createReadStream` does (inclusive start/end).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { Readable } from "node:stream";
import JSZip from "jszip";

vi.mock("@/lib/file-storage", () => ({
  statFile: vi.fn(),
  openReadStream: vi.fn(),
}));

import { openReadStream, statFile } from "@/lib/file-storage";
import {
  DOCX_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  parseCsvPreview,
  readStoredTextPreview,
  renderStoredDocxToSafeHtml,
} from "./document-preview";

// ── In-memory storage stub ─────────────────────────────────────────────

const files = new Map<string, Buffer>();
/** Optional stat-size override so "huge file" tests don't have to
 *  allocate huge buffers. */
const statSizeOverride = new Map<string, number>();

beforeEach(() => {
  vi.clearAllMocks(); // call history must not leak between tests
  files.clear();
  statSizeOverride.clear();
  vi.mocked(statFile).mockImplementation(async (key: string) => {
    if (!files.has(key)) return null;
    return { size: statSizeOverride.get(key) ?? files.get(key)!.length };
  });
  vi.mocked(openReadStream).mockImplementation(
    (key: string, range?: { start: number; end: number }) => {
      const buf = files.get(key);
      if (!buf) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      // fs.createReadStream range semantics: both bounds inclusive.
      const slice = range ? buf.subarray(range.start, range.end + 1) : buf;
      return Readable.from([slice]) as unknown as NodeJS.ReadableStream;
    }
  );
});

// ── DOCX fixture builders (real OOXML, real mammoth) ───────────────────

const CONTENT_TYPES =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';

const ROOT_RELS =
  '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

async function buildDocx(opts: {
  documentXml: string;
  documentRels?: string;
}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  if (opts.documentRels) {
    zip.file("word/_rels/document.xml.rels", opts.documentRels);
  }
  zip.file("word/document.xml", opts.documentXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R_NS =
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

describe("renderStoredDocxToSafeHtml — happy path (real mammoth)", () => {
  test("paragraphs and bold runs convert to sanitized HTML", async () => {
    files.set(
      "k1",
      await buildDocx({
        documentXml:
          `<?xml version="1.0"?><w:document ${W_NS}><w:body>` +
          "<w:p><w:r><w:t>Hello viewer</w:t></w:r></w:p>" +
          "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold text</w:t></w:r></w:p>" +
          "</w:body></w:document>",
      })
    );
    const result = await renderStoredDocxToSafeHtml("k1");
    expect(result).toEqual({
      ok: true,
      html: "<p>Hello viewer</p><p><strong>bold text</strong></p>",
    });
  });

  test("a javascript: hyperlink planted in the OOXML is stripped", async () => {
    // The uploader controls the .docx bytes; mammoth faithfully
    // emits <a href="javascript:alert(1)"> for this relationship.
    // The pipeline's sanitize step must remove the scheme.
    files.set(
      "k2",
      await buildDocx({
        documentRels:
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>',
        documentXml:
          `<?xml version="1.0"?><w:document ${W_NS} ${R_NS}><w:body>` +
          '<w:p><w:hyperlink r:id="rId2"><w:r><w:t>click me</w:t></w:r></w:hyperlink></w:p>' +
          "</w:body></w:document>",
      })
    );
    const result = await renderStoredDocxToSafeHtml("k2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toContain("click me");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("alert");
  });
});

describe("renderStoredDocxToSafeHtml — failure paths", () => {
  test("missing file → reason, not a throw", async () => {
    const result = await renderStoredDocxToSafeHtml("nope");
    expect(result).toEqual({
      ok: false,
      reason: "The file is missing from storage.",
    });
  });

  test("corrupt bytes (not a zip) → conversion reason", async () => {
    files.set("bad", Buffer.from("this is not a zip archive"));
    const result = await renderStoredDocxToSafeHtml("bad");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/could not be converted/i);
  });

  test("over the size cap → reason, and no bytes are read", async () => {
    files.set("huge", Buffer.from("stub"));
    statSizeOverride.set("huge", DOCX_MAX_BYTES + 1);
    const result = await renderStoredDocxToSafeHtml("huge");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/larger than 25 MB/);
    expect(vi.mocked(openReadStream)).not.toHaveBeenCalled();
  });

  test("storage read error → reason, not a throw", async () => {
    files.set("boom", Buffer.from("x"));
    vi.mocked(openReadStream).mockImplementation(() => {
      throw new Error("disk detached");
    });
    const result = await renderStoredDocxToSafeHtml("boom");
    expect(result).toEqual({
      ok: false,
      reason: "The file could not be read from storage.",
    });
  });

  test("document that converts to nothing visible → reason", async () => {
    files.set(
      "empty",
      await buildDocx({
        documentXml: `<?xml version="1.0"?><w:document ${W_NS}><w:body></w:body></w:document>`,
      })
    );
    const result = await renderStoredDocxToSafeHtml("empty");
    expect(result).toEqual({
      ok: false,
      reason: "The document converted to an empty preview.",
    });
  });
});

describe("readStoredTextPreview", () => {
  test("small file reads fully, not truncated", async () => {
    files.set("t1", Buffer.from("line one\nline two\n"));
    const result = await readStoredTextPreview("t1");
    expect(result).toEqual({
      ok: true,
      text: "line one\nline two\n",
      truncated: false,
    });
  });

  test("file past the 1MB cap is truncated with a ranged read", async () => {
    const big = Buffer.alloc(TEXT_PREVIEW_MAX_BYTES + 500, "a".charCodeAt(0));
    files.set("t2", big);
    const result = await readStoredTextPreview("t2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(TEXT_PREVIEW_MAX_BYTES);
    // The read itself must be ranged — never pull bytes past the cap.
    expect(vi.mocked(openReadStream)).toHaveBeenCalledWith("t2", {
      start: 0,
      end: TEXT_PREVIEW_MAX_BYTES - 1,
    });
  });

  test("missing file → reason", async () => {
    const result = await readStoredTextPreview("gone");
    expect(result).toEqual({
      ok: false,
      reason: "The file is missing from storage.",
    });
  });
});

describe("parseCsvPreview", () => {
  test("plain CSV parses to rows (LF)", () => {
    expect(parseCsvPreview("a,b,c\n1,2,3\n4,5,6\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  test("CRLF rows and no trailing newline both work", () => {
    expect(parseCsvPreview("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("quoted cells: embedded commas, doubled quotes, newlines", () => {
    const text = 'name,note\n"Doe, Jane","said ""stop""\nthen left"\n';
    expect(parseCsvPreview(text)).toEqual([
      ["name", "note"],
      ["Doe, Jane", 'said "stop"\nthen left'],
    ]);
  });

  test("empty cells survive", () => {
    expect(parseCsvPreview("a,,c\n,,\n")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });

  test("ragged rows → null (falls back to the pre view)", () => {
    expect(parseCsvPreview("a,b,c\n1,2\n")).toBeNull();
  });

  test("unclosed quote → null", () => {
    expect(parseCsvPreview('a,b\n"unterminated,2\n')).toBeNull();
  });

  test("stray quote mid-cell → null", () => {
    expect(parseCsvPreview('a,b\nval"ue,2\n')).toBeNull();
  });

  test("garbage after a closing quote → null", () => {
    expect(parseCsvPreview('a,b\n"x"y,2\n')).toBeNull();
  });

  test("single column → null (a table adds nothing)", () => {
    expect(parseCsvPreview("just\nplain\nlines\n")).toBeNull();
  });

  test("empty text → null", () => {
    expect(parseCsvPreview("")).toBeNull();
  });
});
