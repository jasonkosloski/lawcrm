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
  storeFile: vi.fn().mockResolvedValue({
    key: "uploads/generated-key.docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 42,
  }),
  deleteFile: vi.fn(),
}));

import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentFirm } from "@/lib/firm";
import { deleteFile, storeFile } from "@/lib/file-storage";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  createDocumentTemplate,
  deleteDocumentTemplate,
  generateDocumentFromTemplate,
  previewDocumentFromTemplate,
  previewTemplateDraft,
  saveDocumentTemplate,
  setDocumentTemplateActive,
  updateDocumentTemplate,
} from "@/app/actions/document-templates";
import { templateFormInitialState } from "@/lib/template-constants";
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
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, name: "Test Attorney" });
  userId = u.userId;
  vi.mocked(requirePermission).mockResolvedValue(userId);
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.mocked(getCurrentFirm).mockResolvedValue(FIRM_PROFILE);

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

const buildForm = (over: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set("name", over.name ?? "Demand letter");
  fd.set("category", over.category ?? "demand_letter");
  fd.set("description", over.description ?? "Standard demand");
  fd.set("body", over.body ?? "Dear {{client.name}}, re {{matter.name}}.");
  return fd;
};

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
  test("create asks for documents.template.create", async () => {
    await createDocumentTemplate(templateFormInitialState, buildForm());
    expect(requirePermission).toHaveBeenCalledWith("documents.template.create");
  });

  test("update + archive ask for documents.template.edit", async () => {
    const t = await seedTemplate();
    await updateDocumentTemplate(t.id, templateFormInitialState, buildForm());
    expect(requirePermission).toHaveBeenCalledWith("documents.template.edit");

    vi.mocked(requirePermission).mockClear();
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
  test("create persists the row with the creator attributed", async () => {
    const res = await createDocumentTemplate(templateFormInitialState, buildForm());
    expect(res.status).toBe("ok");
    const row = await prisma.documentTemplate.findFirstOrThrow();
    expect(row.name).toBe("Demand letter");
    expect(row.category).toBe("demand_letter");
    expect(row.createdById).toBe(userId);
    expect(row.isActive).toBe(true);
  });

  test("create rejects a category outside the curated list", async () => {
    const res = await createDocumentTemplate(
      templateFormInitialState,
      buildForm({ category: "nonsense" }),
    );
    expect(res.status).toBe("error");
    expect(await prisma.documentTemplate.count()).toBe(0);
  });

  test("update rewrites fields; unknown id errors", async () => {
    const t = await seedTemplate();
    const res = await updateDocumentTemplate(
      t.id,
      templateFormInitialState,
      buildForm({ name: "Demand letter v2", body: "{{today}}" }),
    );
    expect(res.status).toBe("ok");
    const row = await prisma.documentTemplate.findUniqueOrThrow({
      where: { id: t.id },
    });
    expect(row.name).toBe("Demand letter v2");
    expect(row.body).toBe("{{today}}");

    const miss = await updateDocumentTemplate("nope", templateFormInitialState, buildForm());
    expect(miss.status).toBe("error");
  });

  test("update keeps an existing non-curated category but refuses to move to a new unknown one", async () => {
    const legacy = await prisma.documentTemplate.create({
      data: {
        name: "Imported memo",
        category: "intake",
        body: "old",
        createdById: userId,
      },
      select: { id: true },
    });
    const kept = await updateDocumentTemplate(
      legacy.id,
      templateFormInitialState,
      buildForm({ category: "intake", body: "typo fixed" }),
    );
    expect(kept.status).toBe("ok");
    const row = await prisma.documentTemplate.findUniqueOrThrow({
      where: { id: legacy.id },
    });
    expect(row.category).toBe("intake");
    expect(row.body).toBe("typo fixed");

    const moved = await updateDocumentTemplate(
      legacy.id,
      templateFormInitialState,
      buildForm({ category: "other-unknown" }),
    );
    expect(moved.status).toBe("error");
  });

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
    expect(file.name).toBe(res.documentName);
    // A .docx is a zip.
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("PK");

    const doc = await prisma.document.findFirstOrThrow({ where: { matterId } });
    expect(doc.id).toBe(res.documentId);
    expect(doc.name).toBe(res.documentName);
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
    await createDocumentTemplate(templateFormInitialState, buildForm());
    const t = await prisma.documentTemplate.findFirstOrThrow();

    await updateDocumentTemplate(
      t.id,
      templateFormInitialState,
      buildForm({ name: "Demand letter v2", body: "{{today}}" }),
    );
    await setDocumentTemplateActive(t.id, false);
    await setDocumentTemplateActive(t.id, true);
    await deleteDocumentTemplate(t.id);

    const rows = await firmEntries();
    expect(rows.map((r) => r.title)).toEqual([
      'Template "Demand letter" created',
      'Template "Demand letter v2" updated',
      'Template "Demand letter v2" archived',
      'Template "Demand letter v2" restored',
      'Template "Demand letter v2" deleted',
    ]);
    expect(rows.every((r) => r.userId === userId)).toBe(true);
    // Old -> new on the small fields; the body is never copied in.
    expect(rows[1]!.detail).toContain('name "Demand letter" -> "Demand letter v2"');
    expect(rows[1]!.detail).toContain("body changed");
    expect(rows[1]!.detail).not.toContain("{{today}}");
  });

  test("a no-op archive (already archived) writes nothing", async () => {
    const t = await seedTemplate({ isActive: false });
    await setDocumentTemplateActive(t.id, false);
    expect(await firmEntries()).toHaveLength(0);
  });

  test("a rejected save writes no entry", async () => {
    await createDocumentTemplate(templateFormInitialState, buildForm({ category: "nonsense" }));
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
      .spyOn(prisma.document, "create")
      .mockRejectedValueOnce(new Error("FK violation"));
    const res = await gen(t.id, M);
    createSpy.mockRestore();
    expect(res.ok).toBe(false);
    expect(deleteFile).toHaveBeenCalledWith("uploads/generated-key.docx");
    expect(await prisma.document.count()).toBe(0);
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
    expect(doc.id).toBe(res.documentId);
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
