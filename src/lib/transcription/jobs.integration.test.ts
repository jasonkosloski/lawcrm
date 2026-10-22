import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/transcription/assemblyai");

import fixture from "./__fixtures__/assemblyai-completed.json";
import { prisma } from "@/lib/prisma";
import { fetchJob, deleteJob } from "@/lib/transcription/assemblyai";
import { finishTranscriptJob } from "@/lib/transcription/jobs";
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
let documentId: string;
let transcriptId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId }));
  ({ documentId } = await seedDocument({
    matterId,
    name: "call.mp3",
    contentType: "audio/mpeg",
  }));
  const t = await prisma.transcript.create({
    data: {
      documentId,
      status: "processing",
      providerJobId: "job-1",
      webhookSecret: "sec",
      requestedById: userId,
      correctedAt: new Date(),
      correctedById: userId,
    },
  });
  transcriptId = t.id;
  await prisma.transcriptSegment.create({
    data: {
      transcriptId,
      index: 0,
      speaker: "A",
      startSeconds: 0,
      endSeconds: 1,
      text: "old",
      words: [],
    },
  });
});

describe("finishTranscriptJob", () => {
  test("completed: writes segments, clears secret, deletes provider job, notifies", async () => {
    vi.mocked(fetchJob).mockResolvedValue({
      status: "completed",
      raw: fixture as never,
    });
    expect(await finishTranscriptJob(transcriptId)).toBe("completed");
    const t = await prisma.transcript.findUniqueOrThrow({
      where: { id: transcriptId },
      include: { segments: { orderBy: { index: "asc" } } },
    });
    expect(t.status).toBe("completed");
    expect(t.webhookSecret).toBeNull();
    expect(t.completedAt).not.toBeNull();
    expect(t.correctedAt).toBeNull();
    expect(t.correctedById).toBeNull();
    expect(t.durationSeconds).toBe(144);
    expect(t.speakers).toEqual({ A: "Speaker A", B: "Speaker B" });
    expect(t.segments.length).toBeGreaterThan(1);
    expect(t.segments.every((s) => s.text !== "old")).toBe(true);
    expect(deleteJob).toHaveBeenCalledWith("job-1");
    const n = await prisma.notification.findMany({ where: { userId } });
    expect(n).toHaveLength(1);
    expect(n[0].type).toBe("transcript_ready");
    expect(n[0].link).toBe(`/matters/${matterId}/documents/${documentId}`);
    // Idempotent: a repeat does nothing.
    vi.mocked(fetchJob).mockClear();
    expect(await finishTranscriptJob(transcriptId)).toBe("completed");
    expect(fetchJob).not.toHaveBeenCalled();
    expect(await prisma.notification.count()).toBe(1);
  });

  test("zero words: completed with zero segments", async () => {
    vi.mocked(fetchJob).mockResolvedValue({
      status: "completed",
      raw: { id: "x", status: "completed", words: [], audio_duration: 30 },
    });
    expect(await finishTranscriptJob(transcriptId)).toBe("completed");
    const t = await prisma.transcript.findUniqueOrThrow({
      where: { id: transcriptId },
      include: { segments: true },
    });
    expect(t.status).toBe("completed");
    expect(t.segments).toHaveLength(0);
  });

  test("provider error: failed + notification", async () => {
    vi.mocked(fetchJob).mockResolvedValue({ status: "error", error: "bad audio" });
    expect(await finishTranscriptJob(transcriptId)).toBe("failed");
    const t = await prisma.transcript.findUniqueOrThrow({ where: { id: transcriptId } });
    expect(t.status).toBe("failed");
    expect(t.error).toBe("bad audio");
    expect(deleteJob).not.toHaveBeenCalled();
    const n = await prisma.notification.findMany({ where: { userId } });
    expect(n.map((x) => x.type)).toEqual(["transcript_failed"]);
  });

  test("still processing: pending, nothing written", async () => {
    vi.mocked(fetchJob).mockResolvedValue({ status: "processing" });
    expect(await finishTranscriptJob(transcriptId)).toBe("pending");
    expect((await prisma.transcript.findUniqueOrThrow({ where: { id: transcriptId } })).status).toBe("processing");
  });

  test("pending over 6 hours: failed Timed out", async () => {
    await prisma.transcript.update({
      where: { id: transcriptId },
      data: { requestedAt: new Date(Date.now() - 7 * 3600_000) },
    });
    vi.mocked(fetchJob).mockResolvedValue({ status: "processing" });
    expect(await finishTranscriptJob(transcriptId)).toBe("failed");
    const t = await prisma.transcript.findUniqueOrThrow({ where: { id: transcriptId } });
    expect(t.status).toBe("failed");
    expect(t.error).toBe("Timed out");
  });

  test("provider fetch throws: pending (retry next sweep)", async () => {
    vi.mocked(fetchJob).mockRejectedValue(new Error("net"));
    expect(await finishTranscriptJob(transcriptId)).toBe("pending");
  });

  test("deleted transcript/document: gone", async () => {
    await prisma.document.delete({ where: { id: documentId } });
    expect(await finishTranscriptJob(transcriptId)).toBe("gone");
  });
});
