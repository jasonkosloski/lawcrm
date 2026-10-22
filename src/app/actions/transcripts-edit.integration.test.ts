import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/matter-access", () => ({
  assertChildMatterAccess: vi.fn(async () => null),
}));
vi.mock("@/lib/permission-check", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/file-storage", () => ({
  activeStorageDriver: vi.fn(() => "vercel-blob"),
  signedBlobUrl: vi.fn(),
  readStoredFile: vi.fn(),
}));
vi.mock("@/lib/transcription/assemblyai");

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/permission-check";
import { assertChildMatterAccess } from "@/lib/matter-access";
import {
  renameTranscriptSpeaker,
  revertTranscriptSegment,
  setSegmentSpeaker,
  updateTranscriptSegment,
} from "@/app/actions/transcripts";
import {
  resetDb,
  seedDocument,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let matterId: string;
let docId: string;
let transcriptId: string;
let segId: string;

const WORDS = [
  { w: "the", s: 0, e: 0.5, c: 0.9 },
  { w: "cat", s: 0.5, e: 1, c: 0.9 },
  { w: "sat", s: 1, e: 1.5, c: 0.9 },
];

async function seedTranscript(status = "completed") {
  const t = await prisma.transcript.create({
    data: {
      documentId: docId,
      status,
      requestedById: userId,
      speakers: { A: "Speaker A", B: "Speaker B" },
    },
  });
  transcriptId = t.id;
  const s = await prisma.transcriptSegment.create({
    data: {
      transcriptId,
      index: 0,
      speaker: "A",
      startSeconds: 0,
      endSeconds: 1.5,
      text: "the cat sat",
      words: WORDS,
    },
  });
  segId = s.id;
}

const seg = () => prisma.transcriptSegment.findUniqueOrThrow({ where: { id: segId } });

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  vi.mocked(requirePermission).mockResolvedValue(userId);
  vi.mocked(assertChildMatterAccess).mockResolvedValue(null);
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId }));
  ({ documentId: docId } = await seedDocument({ matterId, name: "a.mp3", contentType: "audio/mpeg" }));
  await seedTranscript();
});

describe("updateTranscriptSegment", () => {
  test("keeps unchanged word timings, sets originalText once, bumps revision", async () => {
    const r = await updateTranscriptSegment(segId, { text: "the dog sat", revision: 0 });
    expect(r).toEqual({ ok: true, revision: 1 });
    expect(requirePermission).toHaveBeenCalledWith("documents.transcript.edit");
    let s = await seg();
    expect(s.text).toBe("the dog sat");
    expect(s.originalText).toBe("the cat sat");
    const words = s.words as { w: string; s: number; e: number }[];
    expect(words[0]).toMatchObject({ w: "the", s: 0, e: 0.5 });
    expect(words[2]).toMatchObject({ w: "sat", s: 1, e: 1.5 });
    const t = await prisma.transcript.findUniqueOrThrow({ where: { id: transcriptId } });
    expect(t.correctedById).toBe(userId);
    expect(t.correctedAt).not.toBeNull();

    const r2 = await updateTranscriptSegment(segId, { text: "the dog sat down", revision: 1 });
    expect(r2).toEqual({ ok: true, revision: 2 });
    s = await seg();
    expect(s.originalText).toBe("the cat sat");
    expect(revalidatePath).toHaveBeenCalledWith(`/matters/${matterId}/documents/${docId}`);
    expect(await prisma.activityLog.count({ where: { title: "Transcript corrected" } })).toBe(2);
  });

  test("stale revision conflicts and writes nothing", async () => {
    await updateTranscriptSegment(segId, { text: "the dog sat", revision: 0 });
    const r = await updateTranscriptSegment(segId, { text: "a bird sat", revision: 0 });
    expect(r).toEqual({
      ok: false,
      conflict: true,
      error: "Someone else changed this paragraph. Reload to see their version.",
    });
    expect((await seg()).text).toBe("the dog sat");
  });

  test("blank text is refused", async () => {
    const r = await updateTranscriptSegment(segId, { text: "   ", revision: 0 });
    expect(r).toEqual({ ok: false, error: "A paragraph can't be empty." });
    expect((await seg()).text).toBe("the cat sat");
  });

  test("over 5,000 chars is refused", async () => {
    const r = await updateTranscriptSegment(segId, { text: "a ".repeat(2600), revision: 0 });
    expect(r.ok).toBe(false);
    expect((await seg()).revision).toBe(0);
  });

  test("refused while processing", async () => {
    await prisma.transcript.update({ where: { id: transcriptId }, data: { status: "processing" } });
    const r = await updateTranscriptSegment(segId, { text: "the dog sat", revision: 0 });
    expect(r.ok).toBe(false);
    expect((await seg()).text).toBe("the cat sat");
  });

  test("permission redirect propagates; walled access refused", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(updateTranscriptSegment(segId, { text: "x", revision: 0 })).rejects.toThrow("NEXT_REDIRECT");
    vi.mocked(requirePermission).mockResolvedValue(userId);
    vi.mocked(assertChildMatterAccess).mockRejectedValue(new Error("NOT_FOUND"));
    await expect(updateTranscriptSegment(segId, { text: "x", revision: 0 })).rejects.toThrow("NOT_FOUND");
    expect(assertChildMatterAccess).toHaveBeenCalledWith("document", docId);
    expect((await seg()).text).toBe("the cat sat");
  });
});

describe("revertTranscriptSegment", () => {
  test("restores the original text", async () => {
    await updateTranscriptSegment(segId, { text: "the dog sat", revision: 0 });
    const r = await revertTranscriptSegment(segId, 1);
    expect(r).toEqual({ ok: true, revision: 2 });
    const s = await seg();
    expect(s.text).toBe("the cat sat");
    expect(s.originalText).toBeNull();
  });

  test("no-op ok when never edited", async () => {
    expect(await revertTranscriptSegment(segId, 0)).toEqual({ ok: true, revision: 0 });
    expect((await seg()).revision).toBe(0);
  });

  test("stale revision conflicts", async () => {
    await updateTranscriptSegment(segId, { text: "the dog sat", revision: 0 });
    const r = await revertTranscriptSegment(segId, 0);
    expect(r).toMatchObject({ ok: false, conflict: true });
    expect((await seg()).text).toBe("the dog sat");
  });
});

describe("speakers", () => {
  test("reassign to an existing speaker", async () => {
    expect(await setSegmentSpeaker(segId, "B", 0)).toEqual({ ok: true, revision: 1 });
    expect((await seg()).speaker).toBe("B");
  });

  test("new label is added to the transcript", async () => {
    expect(await setSegmentSpeaker(segId, "C", 0)).toEqual({ ok: true, revision: 1 });
    const t = await prisma.transcript.findUniqueOrThrow({ where: { id: transcriptId } });
    expect(t.speakers).toMatchObject({ C: "Speaker C" });
  });

  test("invalid label refused; stale revision conflicts", async () => {
    expect((await setSegmentSpeaker(segId, "zz", 0)).ok).toBe(false);
    expect(await setSegmentSpeaker(segId, "B", 5)).toMatchObject({ ok: false, conflict: true });
    expect((await seg()).speaker).toBe("A");
  });

  test("rename trims and validates", async () => {
    expect(await renameTranscriptSpeaker(transcriptId, "A", "  Officer Diaz ")).toEqual({ ok: true });
    const t = await prisma.transcript.findUniqueOrThrow({ where: { id: transcriptId } });
    expect(t.speakers).toMatchObject({ A: "Officer Diaz", B: "Speaker B" });
    expect((await renameTranscriptSpeaker(transcriptId, "A", "  ")).ok).toBe(false);
    expect((await renameTranscriptSpeaker(transcriptId, "A", "x".repeat(61))).ok).toBe(false);
    expect((await renameTranscriptSpeaker(transcriptId, "Q", "Bob")).ok).toBe(false);
  });

  test("concurrent renames of different speakers both survive", async () => {
    const [a, b] = await Promise.all([
      renameTranscriptSpeaker(transcriptId, "A", "Officer Diaz"),
      renameTranscriptSpeaker(transcriptId, "B", "Witness Lee"),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const t = await prisma.transcript.findUniqueOrThrow({ where: { id: transcriptId } });
    expect(t.speakers).toEqual({ A: "Officer Diaz", B: "Witness Lee" });
  });

  test("concurrent rename and new label both survive", async () => {
    const [a, b] = await Promise.all([
      renameTranscriptSpeaker(transcriptId, "A", "Officer Diaz"),
      setSegmentSpeaker(segId, "C", 0),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const t = await prisma.transcript.findUniqueOrThrow({ where: { id: transcriptId } });
    expect(t.speakers).toEqual({ A: "Officer Diaz", B: "Speaker B", C: "Speaker C" });
  });

  test("segment edits after the transcript was re-queued are refused", async () => {
    await prisma.transcript.update({ where: { id: transcriptId }, data: { status: "queued" } });
    expect((await updateTranscriptSegment(segId, { text: "x y", revision: 0 })).ok).toBe(false);
    expect((await revertTranscriptSegment(segId, 0)).ok).toBe(false);
    expect((await setSegmentSpeaker(segId, "B", 0)).ok).toBe(false);
    expect(await renameTranscriptSpeaker(transcriptId, "A", "Bob")).toMatchObject({ ok: false });
    const s = await seg();
    expect(s.text).toBe("the cat sat");
    expect(s.revision).toBe(0);
  });

  test("rename is walled", async () => {
    vi.mocked(assertChildMatterAccess).mockRejectedValue(new Error("NOT_FOUND"));
    await expect(renameTranscriptSpeaker(transcriptId, "A", "Bob")).rejects.toThrow("NOT_FOUND");
  });
});
