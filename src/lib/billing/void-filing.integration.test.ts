/**
 * Replacing an invoice's filed PDFs with VOID-stamped copies in place.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

const store = new Map<string, Buffer>();
let counter = 0;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/file-storage", () => ({
  readStoredFile: vi.fn(async (k: string) => store.get(k) ?? null),
  storeFile: vi.fn(async (f: File) => {
    const key = `new${counter++}__${f.name}`;
    store.set(key, Buffer.from(await f.arrayBuffer()));
    return { key, size: f.size, contentType: f.type };
  }),
  deleteFile: vi.fn(async (k: string) => void store.delete(k)),
}));

import { prisma } from "@/lib/prisma";
import { deleteFile, storeFile } from "@/lib/file-storage";
import { stampFiledInvoicePdfs } from "@/lib/billing/void-filing";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let matterId: string;
let invoiceId: string;
let pdfBytes: Buffer;
const day = new Date("2026-10-21T00:00:00.000Z");

async function extractText(buf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    parts.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return parts.join("\n");
}

async function seedDoc(name: string, key: string | null, createdAt: Date) {
  if (key && key !== "gone") store.set(key, pdfBytes);
  return prisma.document.create({
    data: {
      matterId,
      invoiceId,
      name,
      fileUrl: key,
      fileSize: pdfBytes.length,
      contentType: "application/pdf",
      source: "invoice",
      createdAt,
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  store.clear();
  counter = 0;
  await resetDb();
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId });
  const area = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  }));
  invoiceId = (
    await prisma.invoice.create({
      data: { invoiceNumber: "2026-101", matterId, issueDate: day, dueDate: day },
    })
  ).id;
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText("Invoice 2026-101");
  pdfBytes = Buffer.from(await pdf.save());
});

describe("stampFiledInvoicePdfs", () => {
  test("stamps every filed copy in place", async () => {
    const a = await seedDoc("a.pdf", "old-a", new Date("2026-10-01T00:00:00Z"));
    const b = await seedDoc("b.pdf", "old-b", new Date("2026-10-02T00:00:00Z"));
    const res = await stampFiledInvoicePdfs({ invoiceId, matterId, voidedOn: "October 21, 2026" });
    expect(res).toMatchObject({ stamped: 2, failed: 0 });
    expect(res.latest?.name).toBe("b.pdf");
    for (const [doc, old] of [
      [a, "old-a"],
      [b, "old-b"],
    ] as const) {
      const row = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
      expect(row.name).toBe(doc.name);
      expect(row.fileUrl).not.toBe(old);
      const bytes = store.get(row.fileUrl!)!;
      expect(row.fileSize).toBe(bytes.length);
      expect(await extractText(bytes)).toContain("VOID");
      expect(store.has(old)).toBe(false);
    }
    expect(await extractText(res.latest!.bytes)).toContain("VOID");
  });

  test("a missing stored file is counted failed and left alone", async () => {
    const a = await seedDoc("a.pdf", "gone", new Date("2026-10-01T00:00:00Z"));
    const res = await stampFiledInvoicePdfs({ invoiceId, matterId, voidedOn: "October 21, 2026" });
    expect(res).toEqual({
      stamped: 0,
      failed: 1,
      failedNames: ["a.pdf"],
      stampedNames: [],
      latest: null,
    });
    const row = await prisma.document.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.fileUrl).toBe("gone");
  });

  test("losing the update race deletes the new key and counts failed", async () => {
    const a = await seedDoc("a.pdf", "old-a", new Date("2026-10-01T00:00:00Z"));
    vi.mocked(storeFile).mockImplementationOnce(async (f: File) => {
      const key = `new${counter++}__${f.name}`;
      store.set(key, Buffer.from(await f.arrayBuffer()));
      await prisma.document.update({ where: { id: a.id }, data: { fileUrl: "someone-else" } });
      return { key, size: f.size, contentType: f.type } as Awaited<ReturnType<typeof storeFile>>;
    });
    const res = await stampFiledInvoicePdfs({ invoiceId, matterId, voidedOn: "October 21, 2026" });
    expect(res).toEqual({
      stamped: 0,
      failed: 1,
      failedNames: ["a.pdf"],
      stampedNames: [],
      latest: null,
    });
    expect(vi.mocked(deleteFile)).toHaveBeenCalledWith("new0__a.pdf");
    expect(store.has("new0__a.pdf")).toBe(false);
    expect(store.has("old-a")).toBe(true);
  });

  test("keeps the old bytes when another document still shares the key", async () => {
    await seedDoc("a.pdf", "shared", new Date("2026-10-01T00:00:00Z"));
    await prisma.document.create({
      data: { matterId, name: "copy.pdf", fileUrl: "shared", contentType: "application/pdf" },
    });
    const res = await stampFiledInvoicePdfs({ invoiceId, matterId, voidedOn: "October 21, 2026" });
    expect(res.stamped).toBe(1);
    expect(store.has("shared")).toBe(true);
  });

  test("no filed documents", async () => {
    expect(await stampFiledInvoicePdfs({ invoiceId, matterId, voidedOn: "x" })).toEqual({
      stamped: 0,
      failed: 0,
      failedNames: [],
      stampedNames: [],
      latest: null,
    });
  });

  test("reports stamped names and ignores documents on another matter", async () => {
    await seedDoc("a.pdf", "old-a", new Date("2026-10-01T00:00:00Z"));
    const other = await seedMatter({
      practiceAreaId: (await prisma.matter.findUniqueOrThrow({ where: { id: matterId } }))
        .practiceAreaId,
      stageId: (await prisma.matter.findUniqueOrThrow({ where: { id: matterId } })).stageId,
      leadUserId: (await prisma.user.findFirstOrThrow()).id,
    });
    store.set("old-x", pdfBytes);
    const stray = await prisma.document.create({
      data: {
        matterId: other.matterId,
        invoiceId,
        name: "x.pdf",
        fileUrl: "old-x",
        contentType: "application/pdf",
      },
    });
    const res = await stampFiledInvoicePdfs({ invoiceId, matterId, voidedOn: "x" });
    expect(res.stampedNames).toEqual(["a.pdf"]);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: stray.id } })).fileUrl).toBe(
      "old-x",
    );
  });
});
