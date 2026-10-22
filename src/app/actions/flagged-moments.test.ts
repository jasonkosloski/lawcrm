/**
 * Integration tests for the flagged-moment action surface.
 *
 * Covers:
 *   - createFlaggedMoment anchor × renderer matrix: each renderer
 *     accepts exactly one anchored kind (media→time, pdf→page,
 *     docx/text/csv→quote) plus anchorless; everything else is a
 *     form error that writes nothing. At most one kind per flag.
 *   - Validation: negative time, >24h cap, endSeconds ≤ timeSeconds,
 *     orphan endSeconds, page bounds (1..20000, integer), quote
 *     bounds (trimmed 1..500), unknown category, empty / >500-char
 *     description.
 *   - Persistence: each anchor kind lands with the right shape and
 *     an ActivityLog "evidence" entry.
 *   - updateFlaggedMoment kind lock: anchor values move within a
 *     kind (incl. point↔span); kind switches are rejected — a
 *     different anchor kind is a different fact (delete + re-flag).
 *   - Ownership gating (mirrors notes.ts): creators edit/delete
 *     their own flags without the _any keys; crossing ownership
 *     calls requirePermission with evidence.flag.edit_any /
 *     .delete_any respectively — and a denial (requirePermission
 *     throwing, as the real redirect does) leaves the row untouched.
 *
 * Auth + permission gates are stubbed; the gate itself is covered in
 * `permission-check.integration.test.ts`.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { MAX_QUOTE_CHARS } from "@/lib/flag-anchor";
import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  createFlaggedMoment,
  deleteFlaggedMoment,
  updateFlaggedMoment,
} from "@/app/actions/flagged-moments";
import {
  resetDb,
  seedDocument,
  seedFirm,
  seedFlaggedMoment,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedRequire = vi.mocked(requirePermission);

let firmId: string;
let userId: string;
let otherUserId: string;
let matterId: string;
let videoDocId: string;
let audioDocId: string;
let pdfDocId: string;
let docxDocId: string;
let imageDocId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
  const u = await seedUser({ firmId });
  userId = u.userId;
  const u2 = await seedUser({ firmId, name: "Other Reviewer" });
  otherUserId = u2.userId;
  mockedGetUser.mockResolvedValue(userId);
  // Default: gates pass and return the current user (the real
  // requirePermission returns the userId for chaining).
  mockedRequire.mockImplementation(async () => userId);

  const area = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;

  videoDocId = (
    await seedDocument({
      matterId,
      name: "Bodycam 2026-01-04.mp4",
      contentType: "video/mp4",
    })
  ).documentId;
  audioDocId = (
    await seedDocument({
      matterId,
      // No contentType — the extension fallback must still classify
      // this as audio (typeless uploads are common).
      name: "911 call.mp3",
      contentType: null,
    })
  ).documentId;
  pdfDocId = (
    await seedDocument({
      matterId,
      name: "Complaint.pdf",
      contentType: "application/pdf",
    })
  ).documentId;
  docxDocId = (
    await seedDocument({
      matterId,
      name: "Deposition transcript.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })
  ).documentId;
  imageDocId = (
    await seedDocument({
      matterId,
      name: "Scene photo.jpg",
      contentType: "image/jpeg",
    })
  ).documentId;
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Anchorless base — each anchor kind spreads onto this. */
const noteOnly = {
  category: "critical" as const,
  description: "Officer draws weapon",
};

const validInput = { ...noteOnly, timeSeconds: 75 };

describe("createFlaggedMoment — anchor × renderer fit", () => {
  test("flags a video document (point moment) and logs activity", async () => {
    const res = await createFlaggedMoment(videoDocId, validInput);
    expect(res.ok).toBe(true);
    expect(mockedRequire).toHaveBeenCalledWith("evidence.flag.create");

    const row = await prisma.flaggedMoment.findUnique({
      where: { id: res.id! },
    });
    expect(row).toMatchObject({
      documentId: videoDocId,
      timeSeconds: 75,
      endSeconds: null,
      category: "critical",
      description: "Officer draws weapon",
      flaggedById: userId,
    });

    const log = await prisma.activityLog.findFirst({
      where: { matterId, type: "evidence" },
    });
    expect(log?.title).toBe("Moment flagged at 1:15");
    expect(log?.detail).toContain("Bodycam 2026-01-04.mp4");
  });

  test("typeless .mp3 resolves as audio via extension fallback", async () => {
    const res = await createFlaggedMoment(audioDocId, {
      ...validInput,
      endSeconds: 90,
    });
    expect(res.ok).toBe(true);
    const row = await prisma.flaggedMoment.findFirst({
      where: { documentId: audioDocId },
    });
    expect(row?.endSeconds).toBe(90);
  });

  test("PDF takes a page anchor", async () => {
    const res = await createFlaggedMoment(pdfDocId, {
      ...noteOnly,
      pageNumber: 12,
    });
    expect(res.ok).toBe(true);
    const row = await prisma.flaggedMoment.findUnique({ where: { id: res.id! } });
    expect(row).toMatchObject({
      documentId: pdfDocId,
      timeSeconds: null,
      pageNumber: 12,
      quote: null,
    });
    const log = await prisma.activityLog.findFirst({
      where: { matterId, type: "evidence" },
    });
    expect(log?.title).toBe("Page 12 flagged");
  });

  test("PDF takes page + quote (text selected on that page)", async () => {
    const res = await createFlaggedMoment(pdfDocId, {
      ...noteOnly,
      pageNumber: 4,
      quote: "  the light was red  ",
    });
    expect(res.ok).toBe(true);
    const row = await prisma.flaggedMoment.findUnique({ where: { id: res.id! } });
    expect(row).toMatchObject({ pageNumber: 4, quote: "the light was red", timeSeconds: null });
    const log = await prisma.activityLog.findFirst({
      where: { matterId, type: "evidence" },
    });
    expect(log?.title).toBe("Passage flagged: p. 4 · “the light was red”");
  });

  test("PDF takes a page span, with or without a quote", async () => {
    const span = await createFlaggedMoment(pdfDocId, { ...noteOnly, pageNumber: 4, endPageNumber: 6 });
    expect(span.ok).toBe(true);
    expect(await prisma.flaggedMoment.findUnique({ where: { id: span.id! } })).toMatchObject({
      pageNumber: 4,
      endPageNumber: 6,
      quote: null,
    });
    const passage = await createFlaggedMoment(pdfDocId, {
      ...noteOnly,
      pageNumber: 9,
      endPageNumber: 10,
      quote: "the driver accelerated",
    });
    expect(passage.ok).toBe(true);
    const titles = (await prisma.activityLog.findMany({ where: { matterId, type: "evidence" } })).map((l) => l.title);
    expect(titles).toEqual(
      expect.arrayContaining(["Pages 4–6 flagged", "Passage flagged: pp. 9–10 · “the driver accelerated”"])
    );
  });

  test.each([
    ["no start page", { endPageNumber: 3 }, /needs a start page/i],
    ["end before start", { pageNumber: 5, endPageNumber: 5 }, /after its first/i],
    ["too long a span", { pageNumber: 1, endPageNumber: 100 }, /at most 25 pages/i],
  ])("page spans: rejects %s", async (_label, anchor, msg) => {
    const res = await createFlaggedMoment(pdfDocId, { ...noteOnly, ...anchor });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(msg);
    expect(await prisma.flaggedMoment.count()).toBe(0);
  });

  test("page + quote is PDF-only; time + page is never valid", async () => {
    const onDocx = await createFlaggedMoment(docxDocId, { ...noteOnly, pageNumber: 2, quote: "x" });
    expect(onDocx.ok).toBe(false);
    const timePage = await createFlaggedMoment(videoDocId, { ...noteOnly, timeSeconds: 5, pageNumber: 2 });
    expect(timePage.ok).toBe(false);
    expect(timePage.error).toMatch(/at most one anchor/i);
    expect(await prisma.flaggedMoment.count()).toBe(0);
  });

  test("a media flag stores time span + trimmed transcript quote", async () => {
    const res = await createFlaggedMoment(videoDocId, {
      ...noteOnly,
      timeSeconds: 75,
      endSeconds: 90,
      quote: "  I never saw the light  ",
    });
    expect(res.ok).toBe(true);
    const row = await prisma.flaggedMoment.findUnique({ where: { id: res.id! } });
    expect(row).toMatchObject({
      timeSeconds: 75,
      endSeconds: 90,
      quote: "I never saw the light",
      pageNumber: null,
    });
  });

  test("a quote alone never stands in for the time on a media document", async () => {
    const res = await createFlaggedMoment(videoDocId, { ...noteOnly, quote: "some text" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timestamp/i);
    expect(await prisma.flaggedMoment.count()).toBe(0);
  });

  test("rendered text (docx) takes a quote anchor, trimmed", async () => {
    const res = await createFlaggedMoment(docxDocId, {
      ...noteOnly,
      quote: "  I never saw the light change  ",
    });
    expect(res.ok).toBe(true);
    const row = await prisma.flaggedMoment.findUnique({ where: { id: res.id! } });
    expect(row).toMatchObject({
      quote: "I never saw the light change",
      timeSeconds: null,
      pageNumber: null,
    });
  });

  test("anchorless flags the document as a whole — any renderer", async () => {
    for (const docId of [videoDocId, pdfDocId, docxDocId, imageDocId]) {
      const res = await createFlaggedMoment(docId, noteOnly);
      expect(res.ok).toBe(true);
      const row = await prisma.flaggedMoment.findUnique({
        where: { id: res.id! },
      });
      expect(row).toMatchObject({
        timeSeconds: null,
        endSeconds: null,
        pageNumber: null,
        quote: null,
      });
    }
    const log = await prisma.activityLog.findFirst({
      where: { matterId, type: "evidence" },
    });
    expect(log?.title).toBe("Document flagged");
  });

  test.each([
    // [docId label, doc, anchor that does NOT fit, expected message]
    ["time on a PDF", () => pdfDocId, { timeSeconds: 75 }, /page/i],
    ["quote on a PDF", () => pdfDocId, { quote: "some text" }, /page/i],
    ["page on a video", () => videoDocId, { pageNumber: 3 }, /timestamp/i],
    ["quote on a video", () => videoDocId, { quote: "some text" }, /timestamp/i],
    ["time on a docx", () => docxDocId, { timeSeconds: 5 }, /quoted text/i],
    ["page on a docx", () => docxDocId, { pageNumber: 2 }, /quoted text/i],
    ["time on an image", () => imageDocId, { timeSeconds: 5 }, /whole/i],
    ["page on an image", () => imageDocId, { pageNumber: 2 }, /whole/i],
    ["quote on an image", () => imageDocId, { quote: "x" }, /whole/i],
  ])("rejects %s", async (_label, docId, anchor, msg) => {
    const res = await createFlaggedMoment(docId(), { ...noteOnly, ...anchor });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(msg);
    expect(await prisma.flaggedMoment.count()).toBe(0);
  });

  test("more than one anchor kind is rejected before any DB read", async () => {
    const res = await createFlaggedMoment(videoDocId, {
      ...noteOnly,
      timeSeconds: 10,
      pageNumber: 2,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at most one anchor/i);
    expect(await prisma.flaggedMoment.count()).toBe(0);
  });

  test("nonexistent document is a form error, not a thrown FK violation", async () => {
    const res = await createFlaggedMoment("no-such-doc", validInput);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(await prisma.flaggedMoment.count()).toBe(0);
  });
});

describe("createFlaggedMoment — validation", () => {
  test.each([
    [{ timeSeconds: -1 }, /negative/i],
    [{ timeSeconds: 24 * 3600 + 1 }, /24h/i],
    [{ endSeconds: 75 }, /after the start/i], // equal to timeSeconds
    [{ endSeconds: 10 }, /after the start/i], // before timeSeconds
    [{ description: "" }, /note/i],
    [{ description: "x".repeat(501) }, /500/],
  ])("rejects %o", async (patch, msg) => {
    const res = await createFlaggedMoment(videoDocId, {
      ...validInput,
      ...patch,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(msg);
    expect(await prisma.flaggedMoment.count()).toBe(0);
  });

  test("a span end without a start time is rejected", async () => {
    const res = await createFlaggedMoment(videoDocId, {
      ...noteOnly,
      endSeconds: 90,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/needs a start/i);
    expect(await prisma.flaggedMoment.count()).toBe(0);
  });

  test.each([
    [{ pageNumber: 0 }, /start at 1/i],
    [{ pageNumber: -3 }, /start at 1/i],
    [{ pageNumber: 2.5 }, /whole number/i],
    [{ pageNumber: 20001 }, /20000/],
  ])("rejects page anchor %o", async (patch, msg) => {
    const res = await createFlaggedMoment(pdfDocId, { ...noteOnly, ...patch });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(msg);
    expect(await prisma.flaggedMoment.count()).toBe(0);
  });

  test.each([
    [{ quote: "" }, /empty/i],
    [{ quote: "   " }, /empty/i], // trims to nothing
    [{ quote: "q".repeat(MAX_QUOTE_CHARS + 1) }, new RegExp(String(MAX_QUOTE_CHARS))],
  ])("rejects quote anchor %o", async (patch, msg) => {
    const res = await createFlaggedMoment(docxDocId, { ...noteOnly, ...patch });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(msg);
    expect(await prisma.flaggedMoment.count()).toBe(0);
  });

  test("rejects a category outside the catalog", async () => {
    const res = await createFlaggedMoment(videoDocId, {
      ...validInput,
      // deliberately invalid
      category: "vibes" as never,
    });
    expect(res.ok).toBe(false);
    expect(await prisma.flaggedMoment.count()).toBe(0);
  });

  test("description is trimmed before the length check", async () => {
    const res = await createFlaggedMoment(videoDocId, {
      ...validInput,
      description: "   ",
    });
    expect(res.ok).toBe(false);
  });
});

describe("updateFlaggedMoment — ownership", () => {
  test("creator edits their own flag without the _any gate", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: userId,
    });
    const res = await updateFlaggedMoment(flagId, {
      ...validInput,
      timeSeconds: 120,
      endSeconds: 130,
      category: "miranda",
    });
    expect(res.ok).toBe(true);
    expect(mockedRequire).not.toHaveBeenCalled();

    const row = await prisma.flaggedMoment.findUnique({
      where: { id: flagId },
    });
    expect(row).toMatchObject({
      timeSeconds: 120,
      endSeconds: 130,
      category: "miranda",
    });
  });

  test("editing someone else's flag requires evidence.flag.edit_any", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: otherUserId,
    });
    await updateFlaggedMoment(flagId, validInput);
    expect(mockedRequire).toHaveBeenCalledWith("evidence.flag.edit_any");
  });

  test("denied cross-ownership edit leaves the row untouched", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: otherUserId,
      description: "Original note",
    });
    // The real requirePermission redirects (throws) on denial.
    mockedRequire.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(
      updateFlaggedMoment(flagId, { ...validInput, description: "Hijacked" })
    ).rejects.toThrow();
    const row = await prisma.flaggedMoment.findUnique({
      where: { id: flagId },
    });
    expect(row?.description).toBe("Original note");
  });

  test("editing a point flag to a span and back clears endSeconds", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: userId,
      timeSeconds: 10,
      endSeconds: 20,
    });
    const res = await updateFlaggedMoment(flagId, validInput); // no endSeconds
    expect(res.ok).toBe(true);
    const row = await prisma.flaggedMoment.findUnique({
      where: { id: flagId },
    });
    expect(row?.endSeconds).toBeNull();
  });
});

describe("updateFlaggedMoment — anchor kind lock", () => {
  test("anchor values move within the same kind (page → page)", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: pdfDocId,
      flaggedById: userId,
      pageNumber: 3,
    });
    const res = await updateFlaggedMoment(flagId, {
      ...noteOnly,
      pageNumber: 7,
    });
    expect(res.ok).toBe(true);
    const row = await prisma.flaggedMoment.findUnique({ where: { id: flagId } });
    expect(row).toMatchObject({ pageNumber: 7, timeSeconds: null, quote: null });
  });

  test("quote anchors can be re-captured (quote → quote)", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: docxDocId,
      flaggedById: userId,
      quote: "the original passage",
    });
    const res = await updateFlaggedMoment(flagId, {
      ...noteOnly,
      quote: "the corrected passage",
    });
    expect(res.ok).toBe(true);
    const row = await prisma.flaggedMoment.findUnique({ where: { id: flagId } });
    expect(row?.quote).toBe("the corrected passage");
  });

  test("a media flag's quote can change without a kind switch (time → time)", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: userId,
      timeSeconds: 10,
      quote: "old words",
    });
    const res = await updateFlaggedMoment(flagId, {
      ...noteOnly,
      timeSeconds: 10,
      quote: "new words",
    });
    expect(res.ok).toBe(true);
    const row = await prisma.flaggedMoment.findUnique({ where: { id: flagId } });
    expect(row).toMatchObject({ timeSeconds: 10, quote: "new words" });
  });

  test.each([
    // [existing anchor seed, conflicting input patch]
    ["time → page", { timeSeconds: 10 }, { pageNumber: 2 }],
    ["time → anchorless", { timeSeconds: 10 }, {}],
    ["page → time", { timeSeconds: null, pageNumber: 3 }, { timeSeconds: 10 }],
    ["anchorless → quote", { timeSeconds: null }, { quote: "new anchor" }],
  ] as const)(
    "kind switches are rejected: %s (delete and re-flag instead)",
    async (_label, seed, patch) => {
      const { flagId } = await seedFlaggedMoment({
        documentId: videoDocId,
        flaggedById: userId,
        ...seed,
      });
      const before = await prisma.flaggedMoment.findUnique({
        where: { id: flagId },
      });
      const res = await updateFlaggedMoment(flagId, { ...noteOnly, ...patch });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/kind can't change/i);
      // Row untouched — including the anchor columns.
      expect(
        await prisma.flaggedMoment.findUnique({ where: { id: flagId } })
      ).toEqual(before);
    }
  );
});

describe("deleteFlaggedMoment — ownership", () => {
  test("creator deletes their own flag without the _any gate", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: userId,
    });
    const res = await deleteFlaggedMoment(flagId);
    expect(res.ok).toBe(true);
    expect(mockedRequire).not.toHaveBeenCalled();
    expect(await prisma.flaggedMoment.count()).toBe(0);

    // Delete is activity-logged too.
    const log = await prisma.activityLog.findFirst({
      where: { matterId, type: "evidence" },
    });
    expect(log?.title).toMatch(/flag removed/i);
  });

  test("deleting someone else's flag requires evidence.flag.delete_any", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: otherUserId,
    });
    await deleteFlaggedMoment(flagId);
    expect(mockedRequire).toHaveBeenCalledWith("evidence.flag.delete_any");
  });

  test("denied cross-ownership delete keeps the row", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: otherUserId,
    });
    mockedRequire.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(deleteFlaggedMoment(flagId)).rejects.toThrow();
    expect(await prisma.flaggedMoment.count()).toBe(1);
  });

  test("unknown flag id is a soft error", async () => {
    const res = await deleteFlaggedMoment("ghost-flag");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});

describe("update/delete — authenticate before touching the DB", () => {
  // The real getCurrentUserId redirects (throws) with no session.
  // Unknown ids and invalid input must surface that redirect, not a
  // "Flag not found" / validation answer (existence oracle).
  test("updateFlaggedMoment with no session rejects before lookup or validation", async () => {
    mockedGetUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    const findSpy = vi.spyOn(prisma.flaggedMoment, "findUnique");
    await expect(
      updateFlaggedMoment("ghost-flag", { ...validInput, description: "" })
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(findSpy).not.toHaveBeenCalled();
    findSpy.mockRestore();
  });

  test("deleteFlaggedMoment with no session rejects before lookup", async () => {
    mockedGetUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    const findSpy = vi.spyOn(prisma.flaggedMoment, "findUnique");
    await expect(deleteFlaggedMoment("ghost-flag")).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(findSpy).not.toHaveBeenCalled();
    findSpy.mockRestore();
  });

  test("a real flag survives an unauthenticated delete attempt", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: userId,
    });
    mockedGetUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(deleteFlaggedMoment(flagId)).rejects.toThrow();
    expect(await prisma.flaggedMoment.count()).toBe(1);
  });
});

describe("updateFlaggedMoment — point ↔ span (F1000)", () => {
  test("a point flag can be edited into a span", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: userId,
      timeSeconds: 10,
    });
    const res = await updateFlaggedMoment(flagId, {
      ...validInput,
      timeSeconds: 10,
      endSeconds: 25,
    });
    expect(res.ok).toBe(true);
    const row = await prisma.flaggedMoment.findUnique({
      where: { id: flagId },
    });
    expect(row).toMatchObject({ timeSeconds: 10, endSeconds: 25 });
  });
});

describe("update/delete — flag vanished (F1001)", () => {
  test("updating a flag that no longer exists is a soft error", async () => {
    const res = await updateFlaggedMoment("ghost-flag", validInput);
    expect(res).toEqual({ ok: false, error: "Flag not found" });
  });

  test("a flag deleted between lookup and update is a soft error, not a thrown P2025", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: userId,
    });
    const stale = await prisma.flaggedMoment.findUnique({
      where: { id: flagId },
      select: {
        id: true,
        flaggedById: true,
        timeSeconds: true,
        endSeconds: true,
        pageNumber: true,
        quote: true,
        description: true,
        document: { select: { id: true, matterId: true, name: true } },
      },
    });
    await prisma.flaggedMoment.delete({ where: { id: flagId } });
    const spy = vi
      .spyOn(prisma.flaggedMoment, "findUnique")
      .mockResolvedValueOnce(stale as never);
    const res = await updateFlaggedMoment(flagId, validInput);
    spy.mockRestore();
    expect(res).toEqual({ ok: false, error: "Flag not found" });
    // The stale row must leave other viewers' rails.
    expect(revalidatePath).toHaveBeenCalledWith(
      `/matters/${matterId}/documents/${videoDocId}`
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/matters/${matterId}/evidence`);
    // No "Flag edited" entry for a write that never happened.
    expect(
      await prisma.activityLog.count({
        where: { matterId, title: { startsWith: "Flag edited" } },
      })
    ).toBe(0);
  });

  test("a flag deleted between lookup and delete is a soft error and logs nothing", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: userId,
    });
    const stale = await prisma.flaggedMoment.findUnique({
      where: { id: flagId },
      select: {
        id: true,
        timeSeconds: true,
        endSeconds: true,
        pageNumber: true,
        quote: true,
        flaggedById: true,
        document: { select: { id: true, matterId: true, name: true } },
      },
    });
    await prisma.flaggedMoment.delete({ where: { id: flagId } });
    const spy = vi
      .spyOn(prisma.flaggedMoment, "findUnique")
      .mockResolvedValueOnce(stale as never);
    const res = await deleteFlaggedMoment(flagId);
    spy.mockRestore();
    expect(res).toEqual({ ok: false, error: "Flag not found" });
    expect(revalidatePath).toHaveBeenCalledWith(
      `/matters/${matterId}/documents/${videoDocId}`
    );
    expect(
      await prisma.activityLog.count({
        where: { matterId, title: { startsWith: "Flag removed" } },
      })
    ).toBe(0);
  });
});

describe("updateFlaggedMoment — audit trail (F997)", () => {
  test("an edit writes an evidence activity entry with old → new note", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: userId,
      timeSeconds: 75,
      description: "Original wording",
    });
    await updateFlaggedMoment(flagId, {
      ...validInput,
      description: "Revised wording",
    });
    const log = await prisma.activityLog.findFirst({
      where: {
        matterId,
        type: "evidence",
        title: { startsWith: "Flag edited" },
      },
    });
    expect(log).not.toBeNull();
    expect(log!.userId).toBe(userId);
    expect(log!.title).toBe("Flag edited at 1:15");
    expect(log!.detail).toContain("Original wording");
    expect(log!.detail).toContain("Revised wording");
  });

  test("rewriting another reviewer's flag is attributed to the editor and says so", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: otherUserId,
      timeSeconds: 75,
      description: "Attorney's note",
    });
    await updateFlaggedMoment(flagId, {
      ...validInput,
      description: "Rewritten by staff",
    });
    const log = await prisma.activityLog.findFirst({
      where: {
        matterId,
        type: "evidence",
        title: { startsWith: "Flag edited" },
      },
    });
    expect(log!.userId).toBe(userId); // the editor, not the flagger
    expect(log!.title).toMatch(/another reviewer/i);
    // The row still shows the original flagger.
    const row = await prisma.flaggedMoment.findUnique({
      where: { id: flagId },
    });
    expect(row?.flaggedById).toBe(otherUserId);
  });

  test("a retime and recategorise record the new anchor and category", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: userId,
      timeSeconds: 75,
      description: "Same note",
    });
    await updateFlaggedMoment(flagId, {
      ...validInput,
      timeSeconds: 120,
      description: "Same note",
      category: "contradiction",
    });
    const log = await prisma.activityLog.findFirst({
      where: { matterId, title: { startsWith: "Flag edited" } },
    });
    expect(log!.detail).toContain("anchor: 1:15 → 2:00");
    expect(log!.detail).toMatch(/category: \w+ → contradiction/);
  });

  test("a denied or invalid edit writes no entry", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: videoDocId,
      flaggedById: otherUserId,
    });
    mockedRequire.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(updateFlaggedMoment(flagId, validInput)).rejects.toThrow();
    await updateFlaggedMoment(flagId, { ...validInput, description: "" });
    expect(
      await prisma.activityLog.count({
        where: { matterId, title: { startsWith: "Flag edited" } },
      })
    ).toBe(0);
  });
});

describe("updateFlaggedMoment — PDF passages", () => {
  test("a page flag can gain, change or drop its quote (still a page flag)", async () => {
    const { flagId } = await seedFlaggedMoment({
      documentId: pdfDocId,
      flaggedById: userId,
      timeSeconds: null,
      pageNumber: 3,
    });
    const added = await updateFlaggedMoment(flagId, { ...noteOnly, pageNumber: 3, quote: "added" });
    expect(added.ok).toBe(true);
    expect(await prisma.flaggedMoment.findUnique({ where: { id: flagId } })).toMatchObject({
      pageNumber: 3,
      quote: "added",
    });
    const dropped = await updateFlaggedMoment(flagId, { ...noteOnly, pageNumber: 5 });
    expect(dropped.ok).toBe(true);
    expect(await prisma.flaggedMoment.findUnique({ where: { id: flagId } })).toMatchObject({
      pageNumber: 5,
      quote: null,
    });
  });
});

describe("update/delete — evidence-anchored flags respect the matter wall", () => {
  test("a non-member cannot edit or delete an evidence flag on a restricted matter", async () => {
    await prisma.matter.update({
      where: { id: matterId },
      data: { restricted: true },
    });
    const ev = await prisma.evidence.create({
      data: { matterId, type: "audio", description: "Wire recording" },
      select: { id: true },
    });
    const flag = await prisma.flaggedMoment.create({
      data: {
        evidenceId: ev.id,
        timeSeconds: 10,
        category: "emphasis",
        description: "Original",
        flaggedById: otherUserId,
      },
      select: { id: true },
    });
    // otherUserId authored the flag (so the _any gate is not the
    // thing under test) but is not on the restricted matter's team.
    mockedGetUser.mockResolvedValue(otherUserId);
    await expect(
      updateFlaggedMoment(flag.id, { ...validInput, description: "Hijack" })
    ).rejects.toThrow("404");
    await expect(deleteFlaggedMoment(flag.id)).rejects.toThrow(
      "404"
    );
    const row = await prisma.flaggedMoment.findUniqueOrThrow({
      where: { id: flag.id },
    });
    expect(row.description).toBe("Original");
  });
});
