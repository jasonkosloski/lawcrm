/**
 * Integration tests for the document-template actions.
 *
 * Pins (1) that every write asks for the right permission key —
 * create/edit/delete for the library, `documents.upload` for
 * generation and preview alike; (2) the CRUD happy
 * paths against real Postgres; (3) generation end-to-end: merged
 * text handed to file storage, Document row + activity entry on the
 * matter, render-report reporting surfaced to the caller.
 *
 * Storage is mocked (same rationale as documents.test.ts): the test
 * cares about the bytes handed over and the row persisted, not disk.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/file-storage", () => ({
  storeFile: vi.fn(async (file: File) => ({
    key:
      file.type === "application/pdf" ? "uploads/generated-key.pdf" : "uploads/generated-key.docx",
    contentType: file.type,
    size: 42,
  })),
  deleteFile: vi.fn(),
  readStoredFile: vi.fn(),
}));

import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentFirm } from "@/lib/firm";
import { deleteFile, readStoredFile, storeFile } from "@/lib/file-storage";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { resolvedToText } from "@/lib/templates/to-text";
import {
  deleteDocumentTemplate,
  generateDocumentFromTemplate,
  previewDocumentFromTemplate,
  previewTemplateDraft,
  saveDocumentTemplate,
  searchTemplatePreviewRecords,
  setDocumentTemplateActive,
} from "@/app/actions/document-templates";
import {
  resetDb,
  seedContact,
  seedLead,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let firmId: string;
let matterId: string;
let M: { kind: "matter"; matterId: string };

const FIRM_PROFILE = {
  id: "firm-1",
  name: "Test Firm LLC",
  shortName: null,
  ein: null,
  website: null,
  phone: "(303) 555-0100",
  email: "info@testfirm.example",
  addressLine1: "100 Main St",
  addressLine2: null,
  city: "Denver",
  state: "CO",
  zip: "80202",
  country: "US",
  establishedAt: null,
  logoUrl: null,
};

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  vi.mocked(currentUserHasPermission).mockReset();
  vi.mocked(currentUserHasPermission).mockResolvedValue(true);
  ({ firmId } = await seedFirm());
  const u = await seedUser({ firmId, name: "Test Attorney" });
  userId = u.userId;
  vi.mocked(requirePermission).mockResolvedValue(userId);
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  // The firm's DocumentStyle row hangs off the seeded firm.
  vi.mocked(getCurrentFirm).mockResolvedValue({ ...FIRM_PROFILE, id: firmId });

  const { areaId, stageId } = await seedPracticeArea({ name: "Civil Rights" });
  const { contactId } = await seedContact({
    name: "Maria Alvarez",
    email: "maria@example.com",
  });
  const m = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
    name: "Alvarez v. City of Aurora",
  });
  matterId = m.matterId;
  M = { kind: "matter", matterId };
  await prisma.matter.update({
    where: { id: matterId },
    data: { clientId: contactId, caseNumber: "2026-CV-00481" },
  });
});

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string) => ({ type: "text", text: t });
const fieldNode = (path: string) => ({ type: "field", attrs: { path } });
const docOf = (...blocks: unknown[]) => ({ type: "doc", content: blocks });
const jsonDoc = (...blocks: unknown[]) => docOf(...blocks) as unknown as Prisma.InputJsonValue;

/** Generate with the template's current updatedAt (what a preview hands back). */
async function gen(
  templateId: string,
  scope: Parameters<typeof generateDocumentFromTemplate>[1],
  opts: Record<string, unknown> = {},
) {
  const row = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    select: { updatedAt: true },
  });
  return generateDocumentFromTemplate(templateId, scope, {
    expectedUpdatedAt: (row?.updatedAt ?? new Date()).toISOString(),
    ...opts,
  });
}

const seedTemplate = (
  over: Partial<{ body: string; isActive: boolean; kind: string; appliesTo: string }> = {},
) =>
  prisma.documentTemplate.create({
    data: {
      kind: over.kind ?? "letter",
      appliesTo: over.appliesTo ?? "both",
      name: "Demand letter",
      category: "demand_letter",
      body: over.body ?? "Dear {{client.name}}, re {{matter.name}}.",
      isActive: over.isActive ?? true,
      createdById: userId,
    },
    select: { id: true },
  });

describe("permission gates", () => {
  test("archive asks for documents.template.edit", async () => {
    const t = await seedTemplate();
    await setDocumentTemplateActive(t.id, false);
    expect(requirePermission).toHaveBeenCalledWith("documents.template.edit");
  });

  test("hard delete asks for documents.template.delete", async () => {
    const t = await seedTemplate();
    await deleteDocumentTemplate(t.id);
    expect(requirePermission).toHaveBeenCalledWith("documents.template.delete");
  });

  test("generate and preview share the documents.upload key", async () => {
    const t = await seedTemplate();
    await gen(t.id, M);
    expect(requirePermission).toHaveBeenCalledWith("documents.upload");

    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res.ok).toBe(true);
    expect(currentUserHasPermission).toHaveBeenCalledWith("documents.upload");
  });

  test("preview without documents.upload is refused and merges nothing", async () => {
    const t = await seedTemplate();
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key) => key !== "documents.upload",
    );
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res).toEqual({
      ok: false,
      error: "You don't have permission to generate documents from templates.",
    });
  });
});

describe("library CRUD", () => {
  test("archive flips isActive off, restore flips it back", async () => {
    const t = await seedTemplate();
    expect((await setDocumentTemplateActive(t.id, false)).ok).toBe(true);
    expect(
      (
        await prisma.documentTemplate.findUniqueOrThrow({
          where: { id: t.id },
        })
      ).isActive,
    ).toBe(false);

    expect((await setDocumentTemplateActive(t.id, true)).ok).toBe(true);
    expect(
      (
        await prisma.documentTemplate.findUniqueOrThrow({
          where: { id: t.id },
        })
      ).isActive,
    ).toBe(true);
  });

  test("delete removes the row", async () => {
    const t = await seedTemplate();
    expect((await deleteDocumentTemplate(t.id)).ok).toBe(true);
    expect(await prisma.documentTemplate.count()).toBe(0);
  });
});

describe("preview", () => {
  test("renders real matter data, reports missing fields, writes nothing", async () => {
    const t = await seedTemplate({
      body: "Dear {{client.name}} ({{client.phone}}), re {{matter.name}} in {{matter.court}}.",
    });
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.templateName).toBe("Demand letter");
    expect(res.text).toContain("Dear Maria Alvarez");
    expect(res.text).toContain("re Alvarez v. City of Aurora");
    expect(res.text).toContain("not on file");
    expect(res.html).toContain("Maria Alvarez");
    expect(res.report.missing).toHaveLength(2);
    expect(res.needsSigner).toBe(false);
    expect(res.needsRecipient).toBe(false);
    const row = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: t.id } });
    expect(res.templateUpdatedAt).toBe(row.updatedAt.toISOString());
    expect(storeFile).not.toHaveBeenCalled();
    expect(await prisma.document.count()).toBe(0);
  });

  test("archived template refuses to preview", async () => {
    const t = await seedTemplate({ isActive: false });
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res).toEqual({
      ok: false,
      error: "Template not found or archived.",
    });
  });

  test("an email template can't be saved or previewed as a document", async () => {
    const t = await seedTemplate({ kind: "email" });
    const msg = "This template can't be saved as a document.";
    expect(await previewDocumentFromTemplate(t.id, M)).toEqual({ ok: false, error: msg });
    expect(await gen(t.id, M)).toEqual({ ok: false, error: msg });
    expect(storeFile).not.toHaveBeenCalled();
  });

  test("needsSigner and needsRecipient come from the content, including blocks", async () => {
    const block = await prisma.templateBlock.create({
      data: {
        key: "sig_block",
        name: "Sig",
        content: jsonDoc(para(fieldNode("recipient.name"))),
      },
    });
    const t = await prisma.documentTemplate.create({
      data: {
        name: "Struct",
        category: "general",
        kind: "letter",
        appliesTo: "matter",
        content: jsonDoc(para(fieldNode("signer.name")), {
          type: "block",
          attrs: { blockId: block.id },
        }),
      },
    });
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res).toMatchObject({ ok: true, needsSigner: true, needsRecipient: true });
  });

  test("a bad signer is surfaced from the loader", async () => {
    const t = await seedTemplate();
    const stranger = await seedUser({ firmId: (await seedFirm()).firmId, name: "Stranger" });
    const res = await previewDocumentFromTemplate(t.id, M, { signerId: stranger.userId });
    expect(res).toEqual({ ok: false, error: "That signer isn't on this record's team." });
  });
});

describe("generate", () => {
  test("stores a .docx and creates the Document row + activity", async () => {
    const t = await seedTemplate();
    const res = await gen(t.id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(storeFile).toHaveBeenCalledOnce();
    const file = vi.mocked(storeFile).mock.calls[0]![0] as File;
    expect(file.type).toBe(DOCX_MIME);
    expect(file.name).toMatch(/^Demand letter — .+\.docx$/);
    expect(res.documents).toHaveLength(1);
    expect(file.name).toBe(res.documents[0]!.name);
    // A .docx is a zip.
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("PK");

    const doc = await prisma.document.findFirstOrThrow({ where: { matterId } });
    expect(doc.id).toBe(res.documents[0]!.id);
    expect(doc.name).toBe(res.documents[0]!.name);
    expect(doc.source).toBe("generated");
    expect(doc.category).toBe("correspondence");
    expect(doc.fileUrl).toBe("uploads/generated-key.docx");
    expect(doc.folderId).toBeNull();
    expect(doc.uploadedBy).toBe(userId);

    const activity = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, type: "document" },
    });
    expect(activity.title).toBe("Document generated from template");
    expect(activity.detail).toContain("Demand letter");
  });

  test("the saved .docx text contains the rendered client and custodian names", async () => {
    const custodian = await prisma.contact.create({
      data: { name: "Memorial Hospital", type: "medical_provider" },
      select: { id: true },
    });
    const request = await prisma.recordsRequest.create({
      data: { matterId, custodianContactId: custodian.id, adHocTypeName: "CORA", subject: "Chart" },
      select: { id: true },
    });
    const t = await seedTemplate({
      body: "Dear {{client.name}}: records from {{custodian.name}}.",
    });
    const res = await gen(t.id, M, { recordsRequestId: request.id });
    expect(res.ok).toBe(true);
    const file = vi.mocked(storeFile).mock.calls.at(-1)![0] as File;
    const { default: mammoth } = await import("mammoth");
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    expect(value).toContain("Dear Maria Alvarez");
    expect(value).toContain("records from Memorial Hospital");
  });

  test("returns the render report without blocking the save", async () => {
    const t = await seedTemplate({ body: "SOL: {{matter.solDate}}" });
    const res = await gen(t.id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.missing).toEqual(["SOL date"]);
    expect(await prisma.document.count({ where: { matterId } })).toBe(1);
  });

  test("a stale expectedUpdatedAt is refused and nothing is stored", async () => {
    const t = await seedTemplate();
    const row = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: t.id } });
    const res = await generateDocumentFromTemplate(t.id, M, {
      expectedUpdatedAt: new Date(row.updatedAt.getTime() - 5000).toISOString(),
    });
    expect(res).toEqual({
      ok: false,
      error: "This template changed — review the preview again.",
    });
    expect(storeFile).not.toHaveBeenCalled();
    expect(await prisma.document.count()).toBe(0);
  });

  test("a folder on this matter is used; another matter's folder is refused", async () => {
    const t = await seedTemplate();
    const folder = await prisma.documentFolder.create({
      data: { name: "Letters", matterId },
    });
    const ok = await gen(t.id, M, { folderId: folder.id });
    expect(ok.ok).toBe(true);
    const doc = await prisma.document.findFirstOrThrow({ where: { matterId } });
    expect(doc.folderId).toBe(folder.id);

    const { areaId, stageId } = await seedPracticeArea({ name: "Other Area" });
    const other = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Other matter",
    });
    const foreign = await prisma.documentFolder.create({
      data: { name: "Elsewhere", matterId: other.matterId },
    });
    vi.mocked(storeFile).mockClear();
    const bad = await gen(t.id, M, { folderId: foreign.id });
    expect(bad).toEqual({ ok: false, error: "Folder not found." });
    expect(storeFile).not.toHaveBeenCalled();
    expect(await prisma.document.count({ where: { matterId } })).toBe(1);
  });

  test("a referenced archived block still generates and is reported", async () => {
    const block = await prisma.templateBlock.create({
      data: {
        key: "old_sig",
        name: "Old signature",
        isActive: false,
        content: jsonDoc(para(text("Sincerely"))),
      },
    });
    const t = await prisma.documentTemplate.create({
      data: {
        name: "With block",
        category: "general",
        kind: "letter",
        appliesTo: "matter",
        content: jsonDoc({ type: "block", attrs: { blockId: block.id } }),
      },
    });
    const res = await gen(t.id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.archivedBlocks).toEqual(["Old signature"]);
  });

  test("unknown matter / archived template error without writing", async () => {
    const t = await seedTemplate();
    // Unknown == hidden: the matter wall answers with notFound().
    await expect(gen(t.id, { kind: "matter", matterId: "nope" })).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/,
    );

    const archived = await seedTemplate({ isActive: false });
    const res = await gen(archived.id, M);
    expect(res).toEqual({
      ok: false,
      error: "Template not found or archived.",
    });

    expect(storeFile).not.toHaveBeenCalled();
    expect(await prisma.document.count()).toBe(0);
  });
});

describe("previewTemplateDraft", () => {
  const emailInput = () => ({
    kind: "email" as const,
    appliesTo: "matter" as const,
    content: docOf(para(text("Hello "), fieldNode("client.name"))),
    subject: docOf(para(text("Re "), fieldNode("matter.name"))),
  });

  test("renders a sample target with the subject line", async () => {
    const res = await previewTemplateDraft({ ...emailInput(), target: { sample: true } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).toMatch(/^Hello \S/);
    expect(res.subjectText).toMatch(/^Re \S/);
    expect(res.html).toContain("Hello");
    expect(await prisma.document.count()).toBe(0);
  });

  test("subjectText is null for non-email kinds", async () => {
    const res = await previewTemplateDraft({
      ...emailInput(),
      kind: "letter",
      target: { sample: true },
    });
    expect(res).toMatchObject({ ok: true, subjectText: null });
  });

  test("a real target renders the record's data", async () => {
    const res = await previewTemplateDraft({ ...emailInput(), target: { scope: M } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).toContain("Hello Maria Alvarez");
    expect(res.subjectText).toBe("Re Alvarez v. City of Aurora");
  });

  test("a real target the user can't access is rejected", async () => {
    await expect(
      previewTemplateDraft({
        ...emailInput(),
        target: { scope: { kind: "matter", matterId: "nope" } },
      }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/);
  });

  test("needs template edit or create permission", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key) => !key.startsWith("documents.template."),
    );
    const res = await previewTemplateDraft({ ...emailInput(), target: { sample: true } });
    expect(res.ok).toBe(false);
  });

  test("create alone is enough", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key) => key === "documents.template.create",
    );
    const res = await previewTemplateDraft({ ...emailInput(), target: { sample: true } });
    expect(res.ok).toBe(true);
  });

  test("invalid content is returned as an error", async () => {
    const res = await previewTemplateDraft({
      ...emailInput(),
      content: { type: "nope" },
      target: { sample: true },
    });
    expect(res.ok).toBe(false);
  });

  test("loads archived blocks referenced by the draft", async () => {
    const block = await prisma.templateBlock.create({
      data: { key: "gone", name: "Gone", isActive: false, content: jsonDoc(para(text("x"))) },
    });
    const res = await previewTemplateDraft({
      ...emailInput(),
      content: docOf({ type: "block", attrs: { blockId: block.id } }),
      target: { sample: true },
    });
    expect(res).toMatchObject({ ok: true });
    if (res.ok) expect(res.report.archivedBlocks).toEqual(["Gone"]);
  });
});

describe("matter dates (ADR-012 date-only)", () => {
  test("incident + SOL dates stored at UTC midnight print on the stored day for a Denver user", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { timeZone: "America/Denver" },
    });
    await prisma.matter.update({
      where: { id: matterId },
      data: {
        incidentDate: new Date("2025-01-10"),
        statuteOfLimitationsDate: new Date("2027-01-10"),
      },
    });
    const t = await seedTemplate({
      body: "On {{matter.incidentDate}} ... runs {{matter.solDate}}",
    });

    const preview = await previewDocumentFromTemplate(t.id, M);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.text).toBe("On January 10, 2025 ... runs January 10, 2027");

    const res = await gen(t.id, M);
    expect(res.ok).toBe(true);
    expect(vi.mocked(storeFile).mock.calls[0]![0].name).toMatch(/\.docx$/);
  });
});

describe("audit log", () => {
  const firmEntries = () =>
    prisma.activityLog.findMany({
      where: { matterId: null, type: "document" },
      orderBy: { timestamp: "asc" },
    });

  test("create, update, archive, restore and delete each write a firm-scope entry", async () => {
    const c = await saveDocumentTemplate(saveInput({ name: "Demand letter" }));
    if (!c.ok) throw new Error(c.error);
    await saveDocumentTemplate(
      saveInput({ id: c.id, name: "Demand letter v2", expectedUpdatedAt: c.updatedAt }),
    );
    await setDocumentTemplateActive(c.id, false);
    await setDocumentTemplateActive(c.id, true);
    await deleteDocumentTemplate(c.id);

    const rows = await firmEntries();
    expect(rows.map((r) => r.title)).toEqual([
      'Template "Demand letter" created',
      'Template "Demand letter v2" updated',
      'Template "Demand letter v2" archived',
      'Template "Demand letter v2" restored',
      'Template "Demand letter v2" deleted',
    ]);
    expect(rows.every((r) => r.userId === userId)).toBe(true);
  });

  test("a no-op archive (already archived) writes nothing", async () => {
    const t = await seedTemplate({ isActive: false });
    await setDocumentTemplateActive(t.id, false);
    expect(await firmEntries()).toHaveLength(0);
  });

  test("a rejected save writes no entry", async () => {
    await saveDocumentTemplate(saveInput({ category: "nonsense" }));
    expect(await firmEntries()).toHaveLength(0);
  });
});

describe("generate failure handling", () => {
  test("a storage failure returns {ok:false} with a generic message and writes no row", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(storeFile).mockRejectedValueOnce(
      new Error("BlobError: 503 at https://secret.internal/path"),
    );
    const t = await seedTemplate();
    const res = await gen(t.id, M);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).not.toContain("secret.internal");
    expect(await prisma.document.count()).toBe(0);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  test("a failed Document insert removes the already-stored file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(deleteFile).mockResolvedValue(undefined);
    const t = await seedTemplate();
    const createSpy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("FK violation"));
    const res = await gen(t.id, M);
    createSpy.mockRestore();
    expect(res.ok).toBe(false);
    expect(deleteFile).toHaveBeenCalledWith("uploads/generated-key.docx");
    expect(await prisma.document.count()).toBe(0);
  });
});

const PDF_MIME = "application/pdf";
const baseName = (n: string) => n.replace(/\.(docx|pdf)$/, "");
const storedFiles = () => vi.mocked(storeFile).mock.calls.map((c) => c[0] as File);

/** Seeds a firm block and points the firm style's letterhead/continuation at it. */
async function seedStyle(over: Prisma.DocumentStyleUncheckedCreateInput | object = {}) {
  await prisma.templateBlock.deleteMany({ where: { id: { in: ["lh", "cont"] } } });
  await prisma.templateBlock.createMany({
    data: [
      {
        id: "lh",
        key: "lh",
        name: "Letterhead",
        content: jsonDoc(para(text("LETTERHEAD for "), fieldNode("client.name"))),
      },
      { id: "cont", key: "cont", name: "Continuation", content: jsonDoc(para(text("CONT"))) },
    ],
  });
  await prisma.documentStyle.upsert({
    where: { firmId },
    create: { firmId, letterheadBlockId: "lh", continuationBlockId: "cont", ...over },
    update: { letterheadBlockId: "lh", continuationBlockId: "cont", ...over },
  });
}

describe("generate formats", () => {
  test("pdf stores application/pdf with a .pdf name", async () => {
    const t = await seedTemplate();
    const res = await gen(t.id, M, { format: "pdf" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const files = storedFiles();
    expect(files).toHaveLength(1);
    expect(files[0]!.type).toBe(PDF_MIME);
    expect(files[0]!.name).toMatch(/^Demand letter — .+\.pdf$/);
    const bytes = new Uint8Array(await files[0]!.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");
    const doc = await prisma.document.findFirstOrThrow({ where: { matterId } });
    expect(doc).toMatchObject({ name: files[0]!.name, contentType: PDF_MIME });
    expect(res.documents).toEqual([{ id: doc.id, name: files[0]!.name }]);
  });

  test("both stores .docx then .pdf and creates two rows with matching base names", async () => {
    const t = await seedTemplate();
    const res = await gen(t.id, M, { format: "both" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(storedFiles().map((f) => f.type)).toEqual([DOCX_MIME, PDF_MIME]);
    expect(res.documents).toHaveLength(2);
    const [w, p] = res.documents;
    expect(w!.name).toMatch(/\.docx$/);
    expect(p!.name).toMatch(/\.pdf$/);
    expect(baseName(w!.name)).toBe(baseName(p!.name));
    const rows = await prisma.document.findMany({ where: { matterId } });
    expect(rows.map((r) => r.name).sort()).toEqual([w!.name, p!.name].sort());
  });

  test("both: a failing second store deletes the first file and writes no rows", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(deleteFile).mockResolvedValue(undefined);
    vi.mocked(storeFile)
      .mockImplementationOnce(async () => ({
        key: "uploads/generated-key.docx",
        contentType: DOCX_MIME,
        size: 1,
      }))
      .mockRejectedValueOnce(new Error("BlobError: 503"));
    const t = await seedTemplate();
    const res = await gen(t.id, M, { format: "both" });
    expect(res.ok).toBe(false);
    expect(deleteFile).toHaveBeenCalledWith("uploads/generated-key.docx");
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(await prisma.document.count()).toBe(0);
  });

  test("both: a failed transaction deletes both stored files", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(deleteFile).mockResolvedValue(undefined);
    const t = await seedTemplate();
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("deadlock"));
    const res = await gen(t.id, M, { format: "both" });
    spy.mockRestore();
    expect(res.ok).toBe(false);
    expect(
      vi
        .mocked(deleteFile)
        .mock.calls.map((c) => c[0])
        .sort(),
    ).toEqual(["uploads/generated-key.docx", "uploads/generated-key.pdf"]);
    expect(await prisma.document.count()).toBe(0);
  });

  test("the letterhead and continuation blocks render with the same data into the .docx headers", async () => {
    await seedStyle();
    const t = await seedTemplate({ body: "Body for {{client.name}}" });
    const res = await gen(t.id, M);
    expect(res.ok).toBe(true);
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(await storedFiles()[0]!.arrayBuffer());
    const headers = await Promise.all(
      Object.keys(zip.files)
        .filter((n) => /^word\/header\d*\.xml$/.test(n))
        .map((n) => zip.file(n)!.async("string")),
    );
    // Runs split at the field, so check both halves land in one header.
    expect(headers.some((h) => h.includes("LETTERHEAD for") && h.includes("Maria Alvarez"))).toBe(
      true,
    );
    expect(headers.some((h) => h.includes("CONT"))).toBe(true);
  });

  test("an archived letterhead block is reported", async () => {
    await seedStyle();
    await prisma.templateBlock.update({ where: { id: "lh" }, data: { isActive: false } });
    const t = await seedTemplate();
    const res = await gen(t.id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.archivedBlocks).toEqual(["Letterhead"]);
    expect(res.report.warnings).toEqual([]);
  });

  test("filings skip the letterhead and continuation blocks", async () => {
    await seedStyle();
    await prisma.templateBlock.update({ where: { id: "lh" }, data: { isActive: false } });
    const t = await seedTemplate({ kind: "filing" });
    const res = await gen(t.id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.archivedBlocks).toEqual([]);
  });

  test("an unreadable logo is a warning and the files still save", async () => {
    await seedStyle({
      logoKey: "uploads/logo.png",
      logoContentType: "image/png",
      logoPosition: "left",
    });
    vi.mocked(readStoredFile).mockRejectedValueOnce(new Error("gone"));
    const t = await seedTemplate();
    const res = await gen(t.id, M, { format: "both" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.warnings).toEqual(["Logo couldn't be loaded."]);
    expect(readStoredFile).toHaveBeenCalledTimes(1);
    expect(await prisma.document.count({ where: { matterId } })).toBe(2);
  });
});

describe("preview page", () => {
  test("a letter preview carries the page parts, style without logo bytes, and a logo url", async () => {
    await seedStyle({
      logoKey: "uploads/logo.png",
      logoContentType: "image/png",
      logoPosition: "center",
    });
    const t = await seedTemplate({ body: "Hi {{client.name}}" });
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const style = await prisma.documentStyle.findUniqueOrThrow({ where: { firmId } });
    expect(res.page.style.kind).toBe("letter");
    expect(res.page.style.letterhead).toEqual({ blockId: "lh", logo: { position: "center" } });
    expect(resolvedToText(res.page.letterhead!)).toBe("LETTERHEAD for Maria Alvarez");
    expect(resolvedToText(res.page.continuation!)).toBe("CONT");
    expect(res.page.logoUrl).toBe(
      `/api/document-style/logo?v=${encodeURIComponent(style.updatedAt.toISOString())}`,
    );
    expect(readStoredFile).not.toHaveBeenCalled();
    expect(res.text).toBe("Hi Maria Alvarez");
  });

  test("a filing preview has no letterhead, continuation or logo", async () => {
    await seedStyle({ logoKey: "k", logoContentType: "image/png", logoPosition: "left" });
    const t = await seedTemplate({ kind: "filing" });
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.page).toMatchObject({
      letterhead: null,
      continuation: null,
      logoUrl: null,
      style: { kind: "filing", letterhead: null },
    });
  });

  test("draft preview returns a page for letters and none for email", async () => {
    await seedStyle();
    const letter = await previewTemplateDraft({
      kind: "letter",
      appliesTo: "matter",
      content: docOf(para(text("Hello"))),
      target: { scope: M },
    });
    expect(letter.ok && letter.page?.letterhead).toBeTruthy();
    const email = await previewTemplateDraft({
      kind: "email",
      appliesTo: "matter",
      content: docOf(para(text("Hello"))),
      target: { sample: true },
    });
    expect(email).toMatchObject({ ok: true, page: null });
  });
});

describe("generate on a lead", () => {
  test("creates a lead-scoped Document with client from the lead contact and matter fields not on file", async () => {
    const { contactId } = await seedContact({
      name: "Pat Prospect",
      email: "pat@example.com",
    });
    const { leadId } = await seedLead({ name: "Legacy Name", contactId });
    const t = await seedTemplate({
      body: "Dear {{client.name}}, re {{matter.caseNumber}}.",
    });
    const scope = { kind: "lead", leadId } as const;

    const prev = await previewDocumentFromTemplate(t.id, scope);
    expect(prev.ok).toBe(true);

    const res = await gen(t.id, scope);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.missing).toEqual([]);
    expect(res.report.invalid).toEqual(["matter.caseNumber"]);

    const doc = await prisma.document.findFirstOrThrow({ where: { leadId } });
    expect(doc.matterId).toBeNull();
    expect(doc.id).toBe(res.documents[0]!.id);
  });

  test("falls back to the legacy lead columns without a contact", async () => {
    const { leadId } = await seedLead({ name: "Solo Lead" });
    const t = await seedTemplate({ body: "{{client.name}} / {{lead.name}}" });
    const res = await previewDocumentFromTemplate(t.id, {
      kind: "lead",
      leadId,
    });
    expect(res.ok && res.text).toBe("Solo Lead / Solo Lead");
  });

  test("refuses a converted lead without writing", async () => {
    const { leadId } = await seedLead({ name: "Done" });
    await prisma.lead.update({ where: { id: leadId }, data: { stage: "converted" } });
    const t = await seedTemplate();
    const res = await gen(t.id, {
      kind: "lead",
      leadId,
    });
    expect(res).toEqual({
      ok: false,
      error: "This lead is already converted — add this on the matter instead.",
    });
    expect(storeFile).not.toHaveBeenCalled();
    expect(await prisma.document.count()).toBe(0);
  });
});

describe("records request letters", () => {
  async function seedRecordsRequest(over: { matterId?: string; leadId?: string } = {}) {
    const custodian = await prisma.contact.create({
      data: {
        name: "Memorial Hospital",
        type: "medical_provider",
        organization: "Memorial Health",
        email: "records@memorial.example",
        address: "1 Hospital Way",
        city: "Denver",
        state: "CO",
        zip: "80202",
      },
      select: { id: true },
    });
    const useLead = over.leadId !== undefined;
    return prisma.recordsRequest.create({
      data: {
        matterId: useLead ? null : (over.matterId ?? matterId),
        leadId: over.leadId ?? null,
        custodianContactId: custodian.id,
        adHocTypeName: "CORA",
        subject: "Chart 2024",
        dateRangeStart: new Date("2024-01-05T00:00:00Z"),
      },
      select: { id: true },
    });
  }

  test("generate files the letter into Investigation/Records Requests/<custodian — type>/Request documents with the request_letter role", async () => {
    const t = await seedTemplate({
      body: "To {{custodian.name}} ({{custodian.address}}) re {{request.subject}} from {{request.dateRangeStart}}",
    });
    const r = await seedRecordsRequest();
    const res = await gen(t.id, M, {
      recordsRequestId: r.id,
    });
    expect(res.ok).toBe(true);
    expect(requirePermission).toHaveBeenCalledWith("records.edit");
    const doc = await prisma.document.findFirstOrThrow({
      where: { recordsRequestId: r.id },
      include: { folder: { include: { parent: true } } },
    });
    expect(doc.recordsRequestRole).toBe("request_letter");
    expect(doc.folder?.name).toBe("Request documents");
    expect(doc.folder?.parent?.name).toBe("Memorial Hospital — CORA");
    const request = await prisma.documentFolder.findUniqueOrThrow({
      where: { id: doc.folder!.parentId! },
      include: { parent: true },
    });
    expect(request.parent?.name).toBe("Records Requests");
    const file = vi.mocked(storeFile).mock.calls.at(-1)![0] as File;
    expect(file.type).toBe(DOCX_MIME);
  });

  test("both: the .docx and .pdf are each tagged request_letter in the request folder", async () => {
    const t = await seedTemplate();
    const r = await seedRecordsRequest();
    const res = await gen(t.id, M, { recordsRequestId: r.id, format: "both" });
    expect(res.ok).toBe(true);
    const docs = await prisma.document.findMany({ where: { recordsRequestId: r.id } });
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.recordsRequestRole === "request_letter")).toBe(true);
    expect(new Set(docs.map((d) => d.folderId)).size).toBe(1);
    expect(docs[0]!.folderId).not.toBeNull();
    expect(docs.map((d) => d.contentType).sort()).toEqual([PDF_MIME, DOCX_MIME].sort());
  });

  test("preview merges the request fields without writing", async () => {
    const t = await seedTemplate({ body: "{{custodian.name}} / {{request.type}}" });
    const r = await seedRecordsRequest();
    const res = await previewDocumentFromTemplate(t.id, M, {
      recordsRequestId: r.id,
    });
    expect(res).toMatchObject({ ok: true, text: "Memorial Hospital / CORA" });
    expect(await prisma.document.count()).toBe(0);
  });

  test("a request from another scope is refused (generate and preview)", async () => {
    const t = await seedTemplate();
    const { leadId } = await seedLead();
    const foreign = await seedRecordsRequest({ leadId });
    const genRes = await gen(t.id, M, {
      recordsRequestId: foreign.id,
    });
    expect(genRes).toEqual({ ok: false, error: "Records request not found." });
    const prev = await previewDocumentFromTemplate(t.id, M, {
      recordsRequestId: foreign.id,
    });
    expect(prev).toEqual({ ok: false, error: "Records request not found." });
    expect(await prisma.document.count()).toBe(0);
    expect(storeFile).not.toHaveBeenCalled();
  });

  test("without a request the records fields render as not on file and no records.edit is asked", async () => {
    const t = await seedTemplate({ body: "{{custodian.name}}" });
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res).toMatchObject({ ok: true, report: { missing: ["Custodian name"] } });
    await gen(t.id, M);
    expect(requirePermission).not.toHaveBeenCalledWith("records.edit");
  });

  test("preview with a request needs records.view", async () => {
    const t = await seedTemplate({ body: "{{custodian.name}}" });
    const r = await seedRecordsRequest();
    vi.mocked(currentUserHasPermission).mockImplementation(async (key) => key !== "records.view");
    const res = await previewDocumentFromTemplate(t.id, M, {
      recordsRequestId: r.id,
    });
    expect(res).toEqual({
      ok: false,
      error: "You don't have permission to view records requests.",
    });
    expect(currentUserHasPermission).toHaveBeenCalledWith("records.view");
  });
});

// ── Structured save ────────────────────────────────────────────────────

const saveInput = (over: Record<string, unknown> = {}) => ({
  name: "Structured",
  category: "correspondence",
  kind: "letter" as const,
  appliesTo: "matter" as const,
  content: docOf(para(text("Hello "), fieldNode("client.name"))),
  ...over,
});

describe("saveDocumentTemplate", () => {
  test("create asks for create key, edit asks for edit key", async () => {
    const r = await saveDocumentTemplate(saveInput());
    expect(r.ok).toBe(true);
    expect(requirePermission).toHaveBeenCalledWith("documents.template.create");
    if (!r.ok) return;
    vi.mocked(requirePermission).mockClear();
    await saveDocumentTemplate(saveInput({ id: r.id }));
    expect(requirePermission).toHaveBeenCalledWith("documents.template.edit");
  });

  test("create writes content, kind, appliesTo, null body, and logs once", async () => {
    const r = await saveDocumentTemplate(saveInput());
    if (!r.ok) throw new Error(r.error);
    const row = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.body).toBeNull();
    expect(row.kind).toBe("letter");
    expect(row.appliesTo).toBe("matter");
    expect(row.content).toMatchObject({ type: "doc" });
    const logs = await prisma.activityLog.findMany({
      where: { title: 'Template "Structured" created' },
    });
    expect(logs).toHaveLength(1);
  });

  test("update clears legacy body", async () => {
    const t = await seedTemplate();
    const r = await saveDocumentTemplate(saveInput({ id: t.id }));
    expect(r.ok).toBe(true);
    const row = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.body).toBeNull();
    expect(row.content).not.toBeNull();
  });

  test("sms template with a heading is refused", async () => {
    const r = await saveDocumentTemplate(
      saveInput({
        kind: "sms",
        content: docOf({ type: "heading", attrs: { level: 1 }, content: [text("Hi")] }),
      }),
    );
    expect(r.ok).toBe(false);
  });

  test("lead template with matter.caseNumber is refused, naming the field", async () => {
    const r = await saveDocumentTemplate(
      saveInput({ appliesTo: "lead", content: docOf(para(fieldNode("matter.caseNumber"))) }),
    );
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.error).toMatch(/^These fields don't fit a lead template: .+\.$/);
  });

  test("unknown block id is refused", async () => {
    const r = await saveDocumentTemplate(
      saveInput({ content: docOf({ type: "block", attrs: { blockId: "nope" } }) }),
    );
    expect(r).toEqual({ ok: false, error: "A referenced block no longer exists." });
  });

  test("archived block ids are accepted", async () => {
    const b = await prisma.templateBlock.create({
      data: { key: "sig_block", name: "Sig", content: jsonDoc(para(text("x"))), isActive: false },
    });
    const r = await saveDocumentTemplate(
      saveInput({ content: docOf({ type: "block", attrs: { blockId: b.id } }) }),
    );
    expect(r.ok).toBe(true);
  });

  test("refuses a lead-only block in a matter template", async () => {
    const b = await prisma.templateBlock.create({
      data: {
        key: "lead_blk",
        name: "Lead intro",
        content: jsonDoc(para(text("x"))),
        appliesTo: "lead",
      },
    });
    const r = await saveDocumentTemplate(
      saveInput({ content: docOf({ type: "block", attrs: { blockId: b.id } }) }),
    );
    expect(r).toEqual({
      ok: false,
      error: "Lead intro applies to lead only, so it can't go in a matter template.",
    });
  });

  test("refuses a template whose block chain is deeper than 5", async () => {
    // Stored directly: the block save would refuse this chain.
    let child: string | null = null;
    for (let i = 6; i >= 1; i--) {
      const content: Prisma.InputJsonValue = child
        ? jsonDoc(para(text("x")), { type: "block", attrs: { blockId: child } })
        : jsonDoc(para(text("x")));
      child = (
        await prisma.templateBlock.create({ data: { key: `lvl_${i}`, name: `L${i}`, content } })
      ).id;
    }
    const r = await saveDocumentTemplate(
      saveInput({ content: docOf({ type: "block", attrs: { blockId: child } }) }),
    );
    expect(r).toEqual({ ok: false, error: "This would nest blocks more than 5 deep." });
  });

  test("saves a template whose nested block has a misfit field", async () => {
    const inner = await prisma.templateBlock.create({
      data: { key: "inner", name: "Inner", content: jsonDoc(para(fieldNode("matter.caseNumber"))) },
    });
    const outer = await prisma.templateBlock.create({
      data: {
        key: "outer",
        name: "Outer",
        content: jsonDoc({ type: "block", attrs: { blockId: inner.id } }),
      },
    });
    const r = await saveDocumentTemplate(
      saveInput({
        appliesTo: "lead",
        content: docOf({ type: "block", attrs: { blockId: outer.id } }),
      }),
    );
    expect(r.ok).toBe(true);
  });

  test("stale expectedUpdatedAt is refused; fresh one saves", async () => {
    const created = await saveDocumentTemplate(saveInput());
    if (!created.ok) throw new Error(created.error);
    const row = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: created.id } });
    const stale = new Date(row.updatedAt.getTime() - 5000).toISOString();
    const bad = await saveDocumentTemplate(saveInput({ id: created.id, expectedUpdatedAt: stale }));
    expect(bad).toEqual({
      ok: false,
      error: "Someone else saved this template — reload to see their changes.",
    });
    const good = await saveDocumentTemplate(
      saveInput({ id: created.id, expectedUpdatedAt: row.updatedAt.toISOString() }),
    );
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    // The returned version is the row's new updatedAt, so the editor can
    // keep saving without a reload.
    const after = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: created.id } });
    expect(good.updatedAt).toBe(after.updatedAt.toISOString());
    const again = await saveDocumentTemplate(
      saveInput({ id: created.id, expectedUpdatedAt: good.updatedAt }),
    );
    expect(again.ok).toBe(true);
  });

  test("email keeps subject; letter drops it", async () => {
    const subject = docOf(para(text("Re "), fieldNode("matter.name")));
    const e = await saveDocumentTemplate(saveInput({ kind: "email", subject }));
    const l = await saveDocumentTemplate(saveInput({ kind: "letter", subject }));
    if (!e.ok || !l.ok) throw new Error("save failed");
    const er = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: e.id } });
    const lr = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: l.id } });
    expect(er.subject).not.toBeNull();
    expect(lr.subject).toBeNull();
  });
});

describe("template writes log one activity row", () => {
  const count = (title: string) => prisma.activityLog.count({ where: { title } });

  test("update, archive and delete each log once", async () => {
    const c = await saveDocumentTemplate(saveInput());
    if (!c.ok) throw new Error(c.error);
    await saveDocumentTemplate(saveInput({ id: c.id }));
    expect(await count('Template "Structured" updated')).toBe(1);
    await setDocumentTemplateActive(c.id, false);
    expect(await count('Template "Structured" archived')).toBe(1);
    await deleteDocumentTemplate(c.id);
    expect(await count('Template "Structured" deleted')).toBe(1);
  });

  test("unparsable expectedUpdatedAt is a friendly error", async () => {
    const c = await saveDocumentTemplate(saveInput());
    if (!c.ok) throw new Error(c.error);
    const r = await saveDocumentTemplate(saveInput({ id: c.id, expectedUpdatedAt: "garbage" }));
    expect(r.ok).toBe(false);
  });
});

describe("searchTemplatePreviewRecords", () => {
  test("finds visible matters and leads; never a restricted matter the user is not on", async () => {
    const { firmId } = (await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { firmId: true },
    })) as { firmId: string };
    const other = await seedUser({ firmId, name: "Other Attorney" });
    const { areaId, stageId } = await seedPracticeArea({ name: "Torts" });
    const hidden = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: other.userId,
      name: "Alvarez secret matter",
    });
    await prisma.matter.update({ where: { id: hidden.matterId }, data: { restricted: true } });
    const { leadId } = await seedLead({ name: "Alvarez intake" });

    const res = await searchTemplatePreviewRecords("alvarez");
    expect(res).toContainEqual({
      scope: { kind: "matter", matterId },
      label: "Alvarez v. City of Aurora",
    });
    expect(res).toContainEqual({ scope: { kind: "lead", leadId }, label: "Alvarez intake" });
    expect(res.some((r) => r.scope.kind === "matter" && r.scope.matterId === hidden.matterId)).toBe(
      false,
    );
  });

  test("appliesTo narrows the record kinds searched", async () => {
    await seedLead({ name: "Alvarez intake" });
    const leads = await searchTemplatePreviewRecords("alvarez", "lead");
    expect(leads.every((r) => r.scope.kind === "lead")).toBe(true);
    expect(leads).toHaveLength(1);
    const matters = await searchTemplatePreviewRecords("alvarez", "matter");
    expect(matters.every((r) => r.scope.kind === "matter")).toBe(true);
    expect(matters).toHaveLength(1);
  });

  test("returns nothing without template edit or create", async () => {
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    expect(await searchTemplatePreviewRecords("alvarez")).toEqual([]);
  });
});

describe("court formats on filings", () => {
  const docxXml = async (file: File) => {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
    const parts = await Promise.all(
      Object.keys(zip.files)
        .filter((n) => /^word\/(document|styles)\.xml$/.test(n))
        .map((n) => zip.files[n]!.async("string")),
    );
    return parts.join("\n");
  };

  /** A venue with a court format (Courier, 13pt, legal, 1.25in top) on the matter. */
  async function seedCourt(over: Record<string, unknown> = {}, replace?: [string, string]) {
    const f = await prisma.courtFormat.create({
      data: {
        name: "Denver District",
        fontKey: "courier",
        fontSizeHalfPt: 26,
        marginTopIn: "1.25",
        paperSize: "legal",
        ...(replace
          ? { blocks: { create: { blockId: replace[0], replacementBlockId: replace[1] } } }
          : {}),
        ...over,
      },
    });
    const v = await prisma.venue.create({
      data: { name: "Denver", nameKey: "denver", state: "CO", courtFormatId: f.id },
    });
    await prisma.matter.update({ where: { id: matterId }, data: { venueId: v.id } });
    return f;
  }

  async function seedCaption() {
    await prisma.templateBlock.createMany({
      data: [
        { id: "cap", key: "cap", name: "Caption", content: jsonDoc(para(text("HOUSE CAPTION"))) },
        {
          id: "cap2",
          key: "cap2",
          name: "Denver caption",
          content: jsonDoc(para(text("DENVER CAPTION by "), fieldNode("signer.name"))),
        },
      ],
    });
    return prisma.documentTemplate.create({
      data: {
        name: "Motion",
        category: "general",
        kind: "filing",
        appliesTo: "matter",
        content: jsonDoc(para(text("Body for "), fieldNode("client.name")), {
          type: "block",
          attrs: { blockId: "cap" },
        }),
      },
      select: { id: true },
    });
  }

  test("preview uses the court's replacement, signer detection follows it, and reports the court", async () => {
    const t = await seedCaption();
    await seedCourt({}, ["cap", "cap2"]);
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res).toMatchObject({
      ok: true,
      needsSigner: true,
      court: { name: "Denver District", archived: false },
    });
    if (!res.ok) return;
    expect(res.text).toContain("DENVER CAPTION");
    expect(res.text).not.toContain("HOUSE CAPTION");
    expect(res.page.style.font).toBe("courier");
    expect(res.page.style.paperSize).toBe("legal");
  });

  test("generated .docx and PDF carry the court font, size, margin, Legal page and caption", async () => {
    const t = await seedCaption();
    await seedCourt({}, ["cap", "cap2"]);
    const res = await gen(t.id, M, { format: "both" });
    expect(res.ok).toBe(true);
    const [docx, pdf] = storedFiles();
    const xml = await docxXml(docx!);
    expect(xml).toContain("Courier New");
    expect(xml).toContain('w:val="26"');
    expect(xml).toMatch(/w:pgSz[^>]*w:h="20160"/);
    expect(xml).toMatch(/w:pgMar[^>]*w:top="1800"/);
    expect(xml).toContain("DENVER CAPTION");
    expect(xml).not.toContain("HOUSE CAPTION");
    const pdfBuf = Buffer.from(await pdf!.arrayBuffer());
    expect(pdfBuf.toString("latin1")).toMatch(/MediaBox\s*\[\s*0\s+0\s+612(\.0+)?\s+1008/);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pd = await pdfjs.getDocument({ data: new Uint8Array(pdfBuf), verbosity: 0 }).promise;
    const tc = await (await pd.getPage(1)).getTextContent();
    const items = tc.items.filter((it): it is typeof it & { str: string } => "str" in it);
    const pageText = items
      .map((it) => it.str)
      .join("")
      .replace(/\s+/g, " ");
    expect(pageText).toContain("DENVER CAPTION");
    expect(pageText).not.toContain("HOUSE CAPTION");
    const { PDFDocument, PDFDict, PDFName } = await import("pdf-lib");
    const lib = await PDFDocument.load(pdfBuf);
    const fonts: string[] = [];
    for (const [, obj] of lib.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of("Font")) {
        const base = obj.get(PDFName.of("BaseFont"));
        if (base) fonts.push(String(base));
      }
    }
    expect(fonts.some((f) => f.includes("LiberationMono"))).toBe(true);
  });

  test("an inactive court format is ignored and flagged archived", async () => {
    const t = await seedCaption();
    await seedCourt({ isActive: false }, ["cap", "cap2"]);
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res).toMatchObject({ ok: true, court: { name: "Denver District", archived: true } });
    if (!res.ok) return;
    expect(res.text).toContain("HOUSE CAPTION");
    expect(res.page.style.paperSize).toBe("letter");
    await gen(t.id, M);
    const xml = await docxXml(storedFiles().at(-1)!);
    expect(xml).not.toContain("Courier New");
    expect(xml).toMatch(/w:pgSz[^>]*w:h="15840"/);
  });

  test("a venue-less matter and a lead filing are unchanged with court null", async () => {
    const t = await seedCaption();
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res).toMatchObject({ ok: true, court: null, needsSigner: false });
    const { leadId } = await seedLead();
    const lead = await previewDocumentFromTemplate(t.id, { kind: "lead", leadId });
    expect(lead).toMatchObject({ ok: true, court: null });
  });

  test("letters ignore the court format and skip the court query", async () => {
    await seedCourt();
    const t = await seedTemplate({ body: "Hello {{client.name}}" });
    const spy = vi.spyOn(prisma.matter, "findUnique");
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res).toMatchObject({ ok: true, court: null });
    if (!res.ok) return;
    expect(res.page.style.paperSize).toBe("letter");
    expect(spy.mock.calls.some(([a]) => JSON.stringify(a).includes("courtFormat"))).toBe(false);
    spy.mockRestore();
  });

  test("previewTemplateDraft: real filing target reports the court, sample target null", async () => {
    await seedCourt();
    const base = {
      kind: "filing" as const,
      appliesTo: "matter" as const,
      content: docOf(para(text("Hi"))),
    };
    const real = await previewTemplateDraft({ ...base, target: { scope: M } });
    expect(real).toMatchObject({ ok: true, court: { name: "Denver District", archived: false } });
    if (real.ok) expect(real.page?.style.paperSize).toBe("legal");
    const sample = await previewTemplateDraft({ ...base, target: { sample: true } });
    expect(sample).toMatchObject({ ok: true, court: null });
  });
});

describe("saveDocumentTemplate: lock wait timeout", () => {
  test("a transaction timeout (P2028) becomes a try-again refusal", async () => {
    const block = await prisma.templateBlock.create({
      data: { key: "sig", name: "Sig", content: jsonDoc(para(text("Sincerely"))) },
    });
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(Object.assign(new Error("timed out"), { code: "P2028" }) as never);
    try {
      const r = await saveDocumentTemplate(
        saveInput({ content: docOf({ type: "block", attrs: { blockId: block.id } }) }),
      );
      expect(r).toEqual({
        ok: false,
        error: "Someone else is saving blocks right now — try again.",
      });
      // The save asked for explicit limits, not Prisma's 2s/5s defaults.
      expect(spy.mock.calls[0][1]).toEqual({ maxWait: 10_000, timeout: 15_000 });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("document title", () => {
  const titled = (
    documentTitle: string | null,
    content = docOf(para(fieldNode("document.title"))),
  ) =>
    prisma.documentTemplate.create({
      data: {
        kind: "letter",
        appliesTo: "both",
        name: "Demand letter",
        category: "demand_letter",
        content: content as unknown as Prisma.InputJsonValue,
        documentTitle,
        createdById: userId,
      },
      select: { id: true },
    });

  test("save keeps a letter's title, clears it for email, refuses one over 200 characters", async () => {
    const letter = await saveDocumentTemplate(saveInput({ documentTitle: "  Motion to Dismiss " }));
    expect(letter.ok).toBe(true);
    if (!letter.ok) return;
    const row = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: letter.id } });
    expect(row.documentTitle).toBe("Motion to Dismiss");

    const email = await saveDocumentTemplate(
      saveInput({ kind: "email", documentTitle: "Ignored" }),
    );
    expect(email.ok).toBe(true);
    if (!email.ok) return;
    const emailRow = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: email.id } });
    expect(emailRow.documentTitle).toBeNull();

    const long = await saveDocumentTemplate(saveInput({ documentTitle: "x".repeat(201) }));
    expect(long).toEqual({
      ok: false,
      error: "Document title must be 200 characters or fewer.",
    });
  });

  test("preview prints the template's title and says the field is used", async () => {
    const t = await titled("Motion to Dismiss");
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).toContain("Motion to Dismiss");
    expect(res.needsTitle).toBe(true);
    expect(res.documentTitle).toBe("Motion to Dismiss");
  });

  test("a typed title overrides the template's; blank renders as not on file", async () => {
    const t = await titled("Motion to Dismiss");
    const typed = await previewDocumentFromTemplate(t.id, M, { documentTitle: " Reply Brief " });
    expect(typed.ok && typed.text).toContain("Reply Brief");
    expect(typed.ok && typed.documentTitle).toBe("Reply Brief");

    const blank = await previewDocumentFromTemplate(t.id, M, { documentTitle: "  " });
    expect(blank.ok && blank.text).toContain("[Document title — not on file]");
    expect(blank.ok && blank.report.missing).toEqual(["Document title"]);

    const long = await previewDocumentFromTemplate(t.id, M, { documentTitle: "x".repeat(201) });
    expect(long).toEqual({ ok: false, error: "Document title must be 200 characters or fewer." });
  });

  test("the field inside a nested block counts as used", async () => {
    const inner = await prisma.templateBlock.create({
      data: {
        key: "inner",
        name: "Inner",
        content: docOf(para(fieldNode("document.title"))) as unknown as Prisma.InputJsonValue,
      },
    });
    const outer = await prisma.templateBlock.create({
      data: {
        key: "outer",
        name: "Outer",
        content: docOf({
          type: "block",
          attrs: { blockId: inner.id },
        }) as unknown as Prisma.InputJsonValue,
      },
    });
    const t = await titled("Caption Title", docOf({ type: "block", attrs: { blockId: outer.id } }));
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res.ok && res.needsTitle).toBe(true);
    expect(res.ok && res.text).toContain("Caption Title");
  });

  test("a template without the field doesn't ask for a title", async () => {
    const t = await titled("Unused", docOf(para(text("Hello"))));
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res.ok && res.needsTitle).toBe(false);
  });

  test("generate prints the typed title and names the file after it", async () => {
    const t = await titled("Motion to Dismiss");
    const res = await gen(t.id, M, { documentTitle: "Reply Brief" });
    expect(res.ok).toBe(true);
    const file = vi.mocked(storeFile).mock.calls[0]![0] as File;
    expect(file.name).toMatch(/^Reply Brief — .+\.docx$/);
  });

  test("a stored title the document doesn't print doesn't rename the file", async () => {
    const t = await titled("Motion to Dismiss", docOf(para(text("Hello"))));
    const res = await gen(t.id, M);
    expect(res.ok).toBe(true);
    const file = vi.mocked(storeFile).mock.calls[0]![0] as File;
    expect(file.name).toMatch(/^Demand letter — .+\.docx$/);
  });

  test("draft preview against a real record prints no sample title", async () => {
    const res = await previewTemplateDraft({
      content: docOf(para(fieldNode("document.title"))),
      kind: "letter",
      appliesTo: "matter",
      target: { scope: M },
    });
    expect(res.ok && res.text).toContain("[Document title — not on file]");
  });

  test("generate without a title keeps the template-name file name", async () => {
    const t = await titled(null);
    const res = await gen(t.id, M);
    expect(res.ok).toBe(true);
    const file = vi.mocked(storeFile).mock.calls[0]![0] as File;
    expect(file.name).toMatch(/^Demand letter — .+\.docx$/);
  });

  test("draft preview uses the editor's title, else the sample one", async () => {
    const content = docOf(para(fieldNode("document.title")));
    const typed = await previewTemplateDraft({
      content,
      kind: "letter",
      appliesTo: "matter",
      documentTitle: "Draft Title",
      target: { sample: true },
    });
    expect(typed.ok && typed.text).toContain("Draft Title");
    const sample = await previewTemplateDraft({
      content,
      kind: "letter",
      appliesTo: "matter",
      target: { sample: true },
    });
    expect(sample.ok && sample.text).toContain("Sample document title");
  });
});
