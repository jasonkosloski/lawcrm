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

import { requirePermission } from "@/lib/permission-check";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentFirm } from "@/lib/firm";
import { storeFile } from "@/lib/file-storage";
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
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let matterId: string;

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
    await generateDocumentFromTemplate(t.id, matterId);
    expect(requirePermission).toHaveBeenCalledWith("documents.upload");

    vi.mocked(requirePermission).mockClear();
    const res = await previewDocumentFromTemplate(t.id, matterId);
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
    const res = await previewDocumentFromTemplate(t.id, matterId);
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
    const res = await previewDocumentFromTemplate(t.id, matterId);
    expect(res).toEqual({
      ok: false,
      error: "Template not found or archived.",
    });
  });
});

describe("generate", () => {
  test("stores merged text and creates the Document row + activity", async () => {
    const t = await seedTemplate();
    const res = await generateDocumentFromTemplate(t.id, matterId);
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
    const res = await generateDocumentFromTemplate(t.id, matterId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.missing).toEqual(["matter.solDate"]);
    expect(await prisma.document.count({ where: { matterId } })).toBe(1);
  });

  test("unknown matter / archived template error without writing", async () => {
    const t = await seedTemplate();
    const miss = await generateDocumentFromTemplate(t.id, "nope");
    expect(miss).toEqual({ ok: false, error: "Matter not found." });

    const archived = await seedTemplate({ isActive: false });
    const res = await generateDocumentFromTemplate(archived.id, matterId);
    expect(res).toEqual({
      ok: false,
      error: "Template not found or archived.",
    });

    expect(storeFile).not.toHaveBeenCalled();
    expect(await prisma.document.count()).toBe(0);
  });
});
