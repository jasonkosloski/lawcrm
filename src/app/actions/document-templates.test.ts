/**
 * Integration tests for the document-template actions.
 *
 * Pins (1) that every write asks for the right permission key —
 * create/edit/delete for the library, `documents.upload` for
 * generation — and that PREVIEW asks for none; (2) the CRUD happy
 * paths against real Postgres; (3) generation end-to-end: merged
 * text handed to file storage, Document row + activity entry on the
 * matter, unresolved/missing reporting surfaced to the caller.
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
    key: "uploads/generated-key.md",
    contentType: "text/markdown",
    size: 42,
  }),
  deleteFile: vi.fn(),
}));

import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentFirm } from "@/lib/firm";
import { deleteFile, storeFile } from "@/lib/file-storage";
import { prisma } from "@/lib/prisma";
import {
  createDocumentTemplate,
  deleteDocumentTemplate,
  generateDocumentFromTemplate,
  previewDocumentFromTemplate,
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

const buildForm = (over: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set("name", over.name ?? "Demand letter");
  fd.set("category", over.category ?? "demand_letter");
  fd.set("description", over.description ?? "Standard demand");
  fd.set(
    "body",
    over.body ?? "Dear {{client.name}}, re {{matter.name}}."
  );
  return fd;
};

const seedTemplate = (over: Partial<{ body: string; isActive: boolean }> = {}) =>
  prisma.documentTemplate.create({
    data: {
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
    expect(requirePermission).toHaveBeenCalledWith(
      "documents.template.create"
    );
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
    expect(requirePermission).toHaveBeenCalledWith(
      "documents.template.delete"
    );
  });

  test("generate asks for documents.upload; preview asks for nothing", async () => {
    const t = await seedTemplate();
    await generateDocumentFromTemplate(t.id, M);
    expect(requirePermission).toHaveBeenCalledWith("documents.upload");

    vi.mocked(requirePermission).mockClear();
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res.ok).toBe(true);
    // Preview is deliberately ungated — session only (see the
    // action file header for the preview/generate split).
    expect(requirePermission).not.toHaveBeenCalled();
  });
});

describe("library CRUD", () => {
  test("create persists the row with the creator attributed", async () => {
    const res = await createDocumentTemplate(
      templateFormInitialState,
      buildForm()
    );
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
      buildForm({ category: "nonsense" })
    );
    expect(res.status).toBe("error");
    expect(await prisma.documentTemplate.count()).toBe(0);
  });

  test("update rewrites fields; unknown id errors", async () => {
    const t = await seedTemplate();
    const res = await updateDocumentTemplate(
      t.id,
      templateFormInitialState,
      buildForm({ name: "Demand letter v2", body: "{{today}}" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.documentTemplate.findUniqueOrThrow({
      where: { id: t.id },
    });
    expect(row.name).toBe("Demand letter v2");
    expect(row.body).toBe("{{today}}");

    const miss = await updateDocumentTemplate(
      "nope",
      templateFormInitialState,
      buildForm()
    );
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
      buildForm({ category: "intake", body: "typo fixed" })
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
      buildForm({ category: "other-unknown" })
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
      ).isActive
    ).toBe(false);

    expect((await setDocumentTemplateActive(t.id, true)).ok).toBe(true);
    expect(
      (
        await prisma.documentTemplate.findUniqueOrThrow({
          where: { id: t.id },
        })
      ).isActive
    ).toBe(true);
  });

  test("delete removes the row", async () => {
    const t = await seedTemplate();
    expect((await deleteDocumentTemplate(t.id)).ok).toBe(true);
    expect(await prisma.documentTemplate.count()).toBe(0);
  });
});

describe("preview", () => {
  test("merges real matter context and reports missing fields without writing", async () => {
    const t = await seedTemplate({
      body:
        "Dear {{client.name}} ({{client.phone}}), re {{matter.name}} in {{matter.court}}. {{made.up}}",
    });
    const res = await previewDocumentFromTemplate(t.id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).toContain("Dear Maria Alvarez");
    expect(res.text).toContain("re Alvarez v. City of Aurora");
    // Phone + court aren't on file → visible placeholder, reported.
    expect(res.text).toContain("[client.phone — not on file]");
    expect(res.missing).toEqual(["client.phone", "matter.court"]);
    // Typo'd token survives verbatim and is flagged.
    expect(res.text).toContain("{{made.up}}");
    expect(res.unresolved).toEqual(["made.up"]);
    // Nothing persisted, nothing stored.
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
});

describe("generate", () => {
  test("stores merged text and creates the Document row + activity", async () => {
    const t = await seedTemplate();
    const res = await generateDocumentFromTemplate(t.id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // The bytes handed to storage are the MERGED text.
    expect(storeFile).toHaveBeenCalledOnce();
    const file = vi.mocked(storeFile).mock.calls[0]![0];
    expect(await file.text()).toBe(
      "Dear Maria Alvarez, re Alvarez v. City of Aurora."
    );
    expect(file.type).toBe("text/markdown");

    const doc = await prisma.document.findFirstOrThrow({
      where: { matterId },
    });
    expect(doc.id).toBe(res.documentId);
    // "<template name> — <date>.md"
    expect(doc.name).toMatch(/^Demand letter — .+\.md$/);
    expect(doc.name).toBe(res.documentName);
    expect(doc.source).toBe("generated");
    // demand_letter templates file under correspondence.
    expect(doc.category).toBe("correspondence");
    expect(doc.fileUrl).toBe("uploads/generated-key.md");
    expect(doc.uploadedBy).toBe(userId);

    const activity = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, type: "document" },
    });
    expect(activity.title).toBe("Document generated from template");
    expect(activity.detail).toContain("Demand letter");
  });

  test("reports missing fields on the result without blocking the save", async () => {
    const t = await seedTemplate({ body: "SOL: {{matter.solDate}}" });
    const res = await generateDocumentFromTemplate(t.id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.missing).toEqual(["matter.solDate"]);
    expect(await prisma.document.count({ where: { matterId } })).toBe(1);
  });

  test("unknown matter / archived template error without writing", async () => {
    const t = await seedTemplate();
    // Unknown == hidden: the matter wall answers with notFound().
    await expect(generateDocumentFromTemplate(t.id, { kind: "matter", matterId: "nope" })).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/
    );

    const archived = await seedTemplate({ isActive: false });
    const res = await generateDocumentFromTemplate(archived.id, M);
    expect(res).toEqual({
      ok: false,
      error: "Template not found or archived.",
    });

    expect(storeFile).not.toHaveBeenCalled();
    expect(await prisma.document.count()).toBe(0);
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
    expect(preview.text).toBe(
      "On January 10, 2025 ... runs January 10, 2027"
    );

    await generateDocumentFromTemplate(t.id, M);
    const file = vi.mocked(storeFile).mock.calls[0]![0];
    expect(await file.text()).toBe(
      "On January 10, 2025 ... runs January 10, 2027"
    );
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
      buildForm({ name: "Demand letter v2", body: "{{today}}" })
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
    expect(rows[1]!.detail).toContain(
      'name "Demand letter" -> "Demand letter v2"'
    );
    expect(rows[1]!.detail).toContain("body changed");
    expect(rows[1]!.detail).not.toContain("{{today}}");
  });

  test("a no-op archive (already archived) writes nothing", async () => {
    const t = await seedTemplate({ isActive: false });
    await setDocumentTemplateActive(t.id, false);
    expect(await firmEntries()).toHaveLength(0);
  });

  test("a rejected save writes no entry", async () => {
    await createDocumentTemplate(
      templateFormInitialState,
      buildForm({ category: "nonsense" })
    );
    expect(await firmEntries()).toHaveLength(0);
  });
});

describe("generate failure handling", () => {
  test("a storage failure returns {ok:false} with a generic message and writes no row", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(storeFile).mockRejectedValueOnce(
      new Error("BlobError: 503 at https://secret.internal/path")
    );
    const t = await seedTemplate();
    const res = await generateDocumentFromTemplate(t.id, M);
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
    const res = await generateDocumentFromTemplate(t.id, M);
    createSpy.mockRestore();
    expect(res.ok).toBe(false);
    expect(deleteFile).toHaveBeenCalledWith("uploads/generated-key.md");
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

    const res = await generateDocumentFromTemplate(t.id, scope);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.missing).toEqual(["matter.caseNumber"]);

    const file = vi.mocked(storeFile).mock.calls[0]![0];
    const text = await file.text();
    expect(text).toContain("Dear Pat Prospect");
    expect(text).toContain("not on file");

    const doc = await prisma.document.findFirstOrThrow({ where: { leadId } });
    expect(doc.matterId).toBeNull();
    expect(doc.id).toBe(res.documentId);
  });

  test("falls back to the legacy lead columns without a contact", async () => {
    const { leadId } = await seedLead({ name: "Solo Lead" });
    const t = await seedTemplate({ body: "{{client.name}} / {{matter.name}}" });
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
    const res = await generateDocumentFromTemplate(t.id, {
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

  test("generate files the letter into Records/<custodian — type> with the request_letter role", async () => {
    const t = await seedTemplate({
      body: "To {{custodian.name}} ({{custodian.address}}) re {{request.subject}} from {{request.dateRangeStart}}",
    });
    const r = await seedRecordsRequest();
    const res = await generateDocumentFromTemplate(t.id, M, {
      recordsRequestId: r.id,
    });
    expect(res.ok).toBe(true);
    expect(requirePermission).toHaveBeenCalledWith("records.edit");
    const doc = await prisma.document.findFirstOrThrow({
      where: { recordsRequestId: r.id },
      include: { folder: { include: { parent: true } } },
    });
    expect(doc.recordsRequestRole).toBe("request_letter");
    expect(doc.folder?.name).toBe("Memorial Hospital — CORA");
    expect(doc.folder?.parent?.name).toBe("Records");
    const file = vi.mocked(storeFile).mock.calls.at(-1)![0] as File;
    expect(await file.text()).toBe(
      "To Memorial Hospital (1 Hospital Way, Denver, CO 80202) re Chart 2024 from January 5, 2024"
    );
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
    const gen = await generateDocumentFromTemplate(t.id, M, {
      recordsRequestId: foreign.id,
    });
    expect(gen).toEqual({ ok: false, error: "Records request not found." });
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
    expect(res).toMatchObject({ ok: true, missing: ["custodian.name"] });
    await generateDocumentFromTemplate(t.id, M);
    expect(requirePermission).not.toHaveBeenCalledWith("records.edit");
  });

  test("preview with a request needs records.view", async () => {
    const t = await seedTemplate({ body: "{{custodian.name}}" });
    const r = await seedRecordsRequest();
    vi.mocked(currentUserHasPermission).mockResolvedValueOnce(false);
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
