/**
 * Integration tests for the flagged-moment action surface.
 *
 * Covers:
 *   - createFlaggedMoment anchor × renderer matrix: each renderer
 *     accepts exactly one anchored kind (media→time, pdf→page,
 *     docx/text/csv→quote) plus anchorless; everything else is a
 *     form error that writes nothing. At most one kind per flag.
 *   - Validation: negative time, >24h cap, endSeconds ≤ timeSeconds,
 *     orphan endSeconds, page bounds (1..5000, integer), quote
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
    [{ pageNumber: 5001 }, /5000/],
  ])("rejects page anchor %o", async (patch, msg) => {
    const res = await createFlaggedMoment(pdfDocId, { ...noteOnly, ...patch });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(msg);
    expect(await prisma.flaggedMoment.count()).toBe(0);
  });

  test.each([
    [{ quote: "" }, /empty/i],
    [{ quote: "   " }, /empty/i], // trims to nothing
    [{ quote: "q".repeat(501) }, /500/],
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
