/**
 * Excel + email previews (office-preview.ts). Storage is stubbed; the
 * .xlsx is a real minimal workbook built with JSZip, and the .eml is
 * real MIME, so the parsers run for real. The .msg parser is mocked
 * (crafting an Outlook compound file by hand isn't worth it); its
 * test pins the field mapping. What's pinned:
 *   - cells render as readable strings (dates, booleans), trailing
 *     blank rows/cols are trimmed, and the row/column caps report
 *     what they hid
 *   - every sheet comes back, in order
 *   - email bodies go through the hostile-mail sanitizer: no script,
 *     remote tracking images blocked
 *   - size caps and unparseable files are reasons, never throws
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import JSZip from "jszip";

vi.mock("@/lib/file-storage", () => ({
  statFile: vi.fn(),
  readStoredFile: vi.fn(),
}));
vi.mock("@kenjiuno/msgreader", () => ({
  default: vi.fn(),
}));

import MsgReader from "@kenjiuno/msgreader";
import { readStoredFile, statFile } from "@/lib/file-storage";
import { BLOCKED_IMAGE_PLACEHOLDER } from "@/lib/sanitize-html";
import {
  EMAIL_MAX_BYTES,
  SPREADSHEET_MAX_COLS,
  SPREADSHEET_MAX_ROWS,
  formatCell,
  inlineCidImages,
  parseMsg,
  renderStoredEmail,
  renderStoredSpreadsheet,
  shapeSheet,
} from "./office-preview";

const files = new Map<string, Buffer>();
const sizes = new Map<string, number>();
beforeEach(() => {
  files.clear();
  sizes.clear();
  vi.mocked(statFile).mockImplementation(async (key: string) => {
    const f = files.get(key);
    return f ? ({ size: sizes.get(key) ?? f.length } as Awaited<ReturnType<typeof statFile>>) : null;
  });
  vi.mocked(readStoredFile).mockImplementation(async (key: string) => files.get(key) ?? null);
});

/** A minimal two-sheet .xlsx (shared strings + a number + a date). */
async function workbook(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Calls" sheetId="1" r:id="rId1"/><sheet name="Texts" sheetId="2" r:id="rId2"/></sheets></workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`
  );
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4"><si><t>Number</t></si><si><t>Minutes</t></si><si><t>555-0100</t></si><si><t>hello there</t></si></sst>`
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12</v></c></row></sheetData></worksheet>`
  );
  zip.file(
    "xl/worksheets/sheet2.xml",
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>3</v></c></row></sheetData></worksheet>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("formatCell / shapeSheet", () => {
  test("cells read as strings", () => {
    expect(formatCell(null)).toBe("");
    expect(formatCell(12.5)).toBe("12.5");
    expect(formatCell(true)).toBe("TRUE");
    expect(formatCell(new Date("2026-03-03T00:00:00Z"))).toBe("2026-03-03");
    expect(formatCell(new Date("2026-03-03T14:05:00Z"))).toBe("2026-03-03 14:05");
  });

  test("trailing blank rows and columns are trimmed; rows are padded square", () => {
    const s = shapeSheet("S", [
      ["a", null, null],
      ["b", "c", null],
      [null, null, null],
    ]);
    expect(s.rows).toEqual([
      ["a", ""],
      ["b", "c"],
    ]);
    expect(s.hiddenRows).toBe(0);
  });

  test("caps report what they hide", () => {
    const wide = Array.from({ length: SPREADSHEET_MAX_COLS + 5 }, (_, i) => i);
    const data = Array.from({ length: SPREADSHEET_MAX_ROWS + 3 }, () => wide);
    const s = shapeSheet("Big", data);
    expect(s.rows).toHaveLength(SPREADSHEET_MAX_ROWS);
    expect(s.rows[0]).toHaveLength(SPREADSHEET_MAX_COLS);
    expect(s.hiddenRows).toBe(3);
    expect(s.hiddenCols).toBe(5);
  });
});

describe("renderStoredSpreadsheet", () => {
  test("every sheet, in order, as display strings", async () => {
    files.set("k", await workbook());
    const res = await renderStoredSpreadsheet("k");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sheets.map((s) => s.name)).toEqual(["Calls", "Texts"]);
    expect(res.sheets[0].rows).toEqual([
      ["Number", "Minutes"],
      ["555-0100", "12"],
    ]);
    expect(res.sheets[1].rows).toEqual([["hello there"]]);
  });

  test("not a workbook → a reason, not a throw", async () => {
    files.set("k", Buffer.from("definitely not a zip"));
    const res = await renderStoredSpreadsheet("k");
    expect(res).toMatchObject({ ok: false, reason: expect.stringMatching(/could not be read/i) });
  });

  test("missing file → a reason", async () => {
    expect(await renderStoredSpreadsheet("nope")).toMatchObject({ ok: false, reason: expect.stringMatching(/missing/i) });
  });
});

const EML = [
  "From: Officer Smith <smith@pd.example>",
  "To: Dispatch <dispatch@pd.example>, records@pd.example",
  "Cc: Sgt. Lee <lee@pd.example>",
  "Subject: Incident 26-1043",
  "Date: Tue, 03 Mar 2026 22:15:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<p>The light was <b>red</b>.</p><script>alert(1)</script><img src="https://tracker.example/pixel.gif">',
  "--b1",
  "Content-Type: application/pdf",
  'Content-Disposition: attachment; filename="report.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-1.4 fake").toString("base64"),
  "--b1--",
  "",
].join("\r\n");

describe("renderStoredEmail — .eml", () => {
  test("headers, sanitized body, attachments", async () => {
    files.set("e", Buffer.from(EML));
    const res = await renderStoredEmail("e", "eml");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { email } = res;
    expect(email.subject).toBe("Incident 26-1043");
    expect(email.from).toBe("Officer Smith <smith@pd.example>");
    expect(email.to).toEqual(["Dispatch <dispatch@pd.example>", "records@pd.example"]);
    expect(email.cc).toEqual(["Sgt. Lee <lee@pd.example>"]);
    expect(email.date).toBe("2026-03-03T22:15:00.000Z");
    expect(email.html).toContain("<b>red</b>");
    expect(email.html).not.toContain("<script");
    expect(email.html).not.toContain("tracker.example");
    expect(email.html).toContain(BLOCKED_IMAGE_PLACEHOLDER);
    expect(email.attachments).toEqual([{ name: "report.pdf", size: 13 }]);
  });

  test("over the size cap → a reason", async () => {
    files.set("e", Buffer.from(EML));
    sizes.set("e", EMAIL_MAX_BYTES + 1);
    expect(await renderStoredEmail("e", "eml")).toMatchObject({ ok: false, reason: expect.stringMatching(/larger than/i) });
  });
});

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const EML_WITH_LOGO = [
  "From: Records <records@pd.example>",
  "To: counsel@firm.example",
  "Subject: Logo test",
  "MIME-Version: 1.0",
  'Content-Type: multipart/related; boundary="r1"',
  "",
  "--r1",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<p>Report attached.</p><img src="cid:seal@pd" alt="seal"><img src="https://t.example/p.gif">',
  "--r1",
  "Content-Type: image/png",
  "Content-ID: <seal@pd>",
  'Content-Disposition: attachment; filename="seal.png"',
  "Content-Transfer-Encoding: base64",
  "",
  PNG_1PX.toString("base64"),
  "--r1--",
  "",
].join("\r\n");

describe("embedded (cid:) images", () => {
  test("render inline as data: URIs and aren't listed as attachments; remote images stay blocked", async () => {
    files.set("e", Buffer.from(EML_WITH_LOGO));
    const res = await renderStoredEmail("e", "eml");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.email.html).toContain(`src="data:image/png;base64,${PNG_1PX.toString("base64")}"`);
    expect(res.email.html).not.toContain("cid:");
    expect(res.email.html).not.toContain("t.example");
    expect(res.email.attachments).toEqual([]);
  });

  test("only raster types are inlined (no SVG), and unknown cids are left alone", () => {
    const svg = new TextEncoder().encode("<svg/>").buffer as ArrayBuffer;
    const { html, used } = inlineCidImages('<img src="cid:a"><img src="cid:missing">', [
      { contentId: "<a>", mimeType: "image/svg+xml", content: svg },
    ]);
    expect(html).toBe('<img src="cid:a"><img src="cid:missing">');
    expect(used.size).toBe(0);
  });
});

describe("parseMsg — Outlook field mapping", () => {
  test("sender, recipients by type, html body, visible attachments", () => {
    vi.mocked(MsgReader).mockImplementation(
      function () {
        return {
          getFileData: () => ({
            subject: "Re: settlement",
            senderName: "Opposing Counsel",
            senderSmtpAddress: "oc@firm.example",
            clientSubmitTime: "Tue, 03 Mar 2026 10:00:00 GMT",
            recipients: [
              { name: "Ann", smtpAddress: "ann@x.example", recipType: "to" },
              { name: "Bo", email: "bo@x.example", recipType: "cc" },
              { name: "Hidden", email: "h@x.example", recipType: "bcc" },
            ],
            bodyHtml: "<p>Offer: $10k</p><img src='http://t.example/p.png'>",
            body: "Offer: $10k",
            attachments: [
              { fileName: "offer.docx", contentLength: 2048 },
              { fileName: "image001.png", attachmentHidden: true },
            ],
          }),
        } as unknown as MsgReader;
      }
    );
    const email = parseMsg(Buffer.from("x"));
    expect(email.from).toBe("Opposing Counsel <oc@firm.example>");
    expect(email.to).toEqual(["Ann <ann@x.example>"]);
    expect(email.cc).toEqual(["Bo <bo@x.example>"]);
    expect(email.date).toBe("2026-03-03T10:00:00.000Z");
    expect(email.html).toContain("Offer: $10k");
    expect(email.html).not.toContain("t.example");
    expect(email.attachments).toEqual([{ name: "offer.docx", size: 2048 }]);
  });

  test("an unreadable .msg is a reason, not a throw", async () => {
    vi.mocked(MsgReader).mockImplementation(
      function () {
        return { getFileData: () => ({ error: "Unsupported file type!" }) } as unknown as MsgReader;
      }
    );
    files.set("m", Buffer.from("junk"));
    expect(await renderStoredEmail("m", "msg")).toMatchObject({ ok: false, reason: expect.stringMatching(/could not be read/i) });
  });
});
