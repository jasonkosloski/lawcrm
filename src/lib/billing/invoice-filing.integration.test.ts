/**
 * Filing a sent invoice PDF into the matter's "Invoices" system folder.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, Buffer>();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/file-storage", () => ({
  storeFile: vi.fn(async (f: File) => {
    const key = `k__${store.size}__${f.name}`;
    store.set(key, Buffer.from(await f.arrayBuffer()));
    return { key, size: f.size, contentType: f.type };
  }),
  deleteFile: vi.fn(async (k: string) => void store.delete(k)),
}));

import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/file-storage";
import { fileInvoicePdf } from "@/lib/billing/invoice-filing";
import { resetDb, seedFirm, seedMatter, seedPracticeArea, seedUser } from "@/test/integration-helpers";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let userId: string;
let matterId: string;
const day = new Date("2026-10-21T00:00:00.000Z");
const bytes = Buffer.from("%PDF-1.4 test");

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(deleteFile).mockClear();
  store.clear();
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  const area = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  }));
});

describe("fileInvoicePdf", () => {
  test("creates the Invoices folder and a document", async () => {
    const { documentId } = await fileInvoicePdf({
      matterId, invoiceNumber: "2026-101", kind: "initial", bytes, userId, day,
    });
    const folders = await prisma.documentFolder.findMany({ where: { matterId } });
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({ name: "Invoices", systemKind: "invoices", clientShared: false });
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc).toMatchObject({
      name: "Invoice 2026-101 (sent 2026-10-21).pdf",
      category: "correspondence",
      source: "invoice",
      contentType: "application/pdf",
      folderId: folders[0].id,
      uploadedBy: userId,
    });
  });

  test("reuses the folder on later calls", async () => {
    await fileInvoicePdf({ matterId, invoiceNumber: "2026-101", kind: "initial", bytes, userId, day });
    const { documentId } = await fileInvoicePdf({
      matterId, invoiceNumber: "2026-101", kind: "updated", bytes, userId, day,
    });
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(1);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.name).toBe("Invoice 2026-101 (updated 2026-10-21).pdf");
  });

  test("resend is named resent", async () => {
    const { documentId } = await fileInvoicePdf({
      matterId, invoiceNumber: "2026-101", kind: "resend", bytes, userId, day,
    });
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.name).toBe("Invoice 2026-101 (resent 2026-10-21).pdf");
  });

  test("deletes the stored file when the row write fails", async () => {
    vi.spyOn(prisma.document, "create").mockRejectedValueOnce(new Error("db down"));
    await expect(
      fileInvoicePdf({ matterId, invoiceNumber: "2026-101", kind: "initial", bytes, userId, day })
    ).rejects.toThrow("db down");
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteFile).mock.calls[0][0]).toMatch(/^k__/);
  });
});
