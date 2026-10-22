import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/matter-access", () => ({
  assertChildMatterAccess: vi.fn(async () => null),
}));
vi.mock("@/lib/permission-check", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/file-storage", () => ({
  activeStorageDriver: vi.fn(() => "vercel-blob"),
  signedBlobUrl: vi.fn(async (u: string) => `https://signed/${u}`),
  readStoredFile: vi.fn(async () => Buffer.from("bytes")),
}));
vi.mock("@/lib/transcription/assemblyai");

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/permission-check";
import { assertChildMatterAccess } from "@/lib/matter-access";
import { activeStorageDriver, signedBlobUrl } from "@/lib/file-storage";
import {
  deleteJob,
  submitJob,
  transcriptionConfigured,
  uploadBytes,
} from "@/lib/transcription/assemblyai";
import { deleteTranscript, requestTranscript } from "@/app/actions/transcripts";
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

async function audioDoc(fileUrl: string | null = "blob/a.mp3", name = "a.mp3") {
  const { documentId } = await seedDocument({
    matterId,
    name,
    contentType: "audio/mpeg",
  });
  await prisma.document.update({ where: { id: documentId }, data: { fileUrl } });
  return documentId;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  delete process.env.TRANSCRIPTION_MONTHLY_HOURS;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  process.env.AUTH_URL = "https://app.example.com";
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  vi.mocked(requirePermission).mockResolvedValue(userId);
  vi.mocked(assertChildMatterAccess).mockResolvedValue(null);
  vi.mocked(activeStorageDriver).mockReturnValue("vercel-blob");
  vi.mocked(transcriptionConfigured).mockReturnValue(true);
  vi.mocked(submitJob).mockResolvedValue({ jobId: "job-1" });
  vi.mocked(uploadBytes).mockResolvedValue("https://provider/u1");
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId }));
  docId = await audioDoc();
});

describe("requestTranscript", () => {
  test("permission is checked first and its redirect propagates", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(requestTranscript(docId)).rejects.toThrow("NEXT_REDIRECT");
    expect(requirePermission).toHaveBeenCalledWith("documents.transcribe");
    expect(submitJob).not.toHaveBeenCalled();
  });

  test("walled matter is refused", async () => {
    vi.mocked(assertChildMatterAccess).mockRejectedValue(new Error("NOT_FOUND"));
    await expect(requestTranscript(docId)).rejects.toThrow("NOT_FOUND");
    expect(assertChildMatterAccess).toHaveBeenCalledWith("document", docId);
    expect(await prisma.transcript.count()).toBe(0);
  });

  test("PDF is refused", async () => {
    const { documentId } = await seedDocument({
      matterId,
      name: "x.pdf",
      contentType: "application/pdf",
    });
    await prisma.document.update({ where: { id: documentId }, data: { fileUrl: "blob/x.pdf" } });
    expect(await requestTranscript(documentId)).toEqual({
      ok: false,
      error: "Only audio and video can be transcribed.",
    });
  });

  test("not configured is refused", async () => {
    vi.mocked(transcriptionConfigured).mockReturnValue(false);
    expect(await requestTranscript(docId)).toEqual({
      ok: false,
      error: "Transcription isn't set up yet.",
    });
  });

  test("happy path (blob): processing, presigned URL, webhook URL", async () => {
    expect(await requestTranscript(docId)).toEqual({ ok: true, status: "processing" });
    const t = await prisma.transcript.findUniqueOrThrow({ where: { documentId: docId } });
    expect(t.status).toBe("processing");
    expect(t.providerJobId).toBe("job-1");
    expect(t.requestedById).toBe(userId);
    expect(t.webhookSecret).toMatch(/^[0-9a-f]{48}$/);
    expect(signedBlobUrl).toHaveBeenCalledWith("blob/a.mp3", { media: true });
    expect(submitJob).toHaveBeenCalledWith({
      audioUrl: "https://signed/blob/a.mp3",
      webhookUrl: "https://app.example.com/api/webhooks/assemblyai",
      webhookSecret: t.webhookSecret,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/matters/${matterId}/documents/${docId}`);
    expect(await prisma.activityLog.count({ where: { title: "Transcription requested" } })).toBe(1);
  });

  test("local driver uploads bytes and sends no webhook URL", async () => {
    vi.mocked(activeStorageDriver).mockReturnValue("local");
    await requestTranscript(docId);
    expect(uploadBytes).toHaveBeenCalled();
    expect(submitJob).toHaveBeenCalledWith(
      expect.objectContaining({ audioUrl: "https://provider/u1", webhookUrl: null }),
    );
  });

  test("no public origin known means no webhook URL", async () => {
    delete process.env.AUTH_URL;
    await requestTranscript(docId);
    expect(vi.mocked(submitJob).mock.calls[0][0].webhookUrl).toBeNull();
  });

  test("AUTH_URL unset falls back to the Vercel production URL", async () => {
    delete process.env.AUTH_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "litgox.com";
    await requestTranscript(docId);
    expect(vi.mocked(submitJob).mock.calls[0][0].webhookUrl).toBe(
      "https://litgox.com/api/webhooks/assemblyai",
    );
  });

  test("AUTH_URL wins over the Vercel production URL", async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "litgox.com";
    await requestTranscript(docId);
    expect(vi.mocked(submitJob).mock.calls[0][0].webhookUrl).toBe(
      "https://app.example.com/api/webhooks/assemblyai",
    );
  });

  test("provider error text has links stripped before it is stored", async () => {
    vi.mocked(submitJob).mockRejectedValue(
      new Error(
        "AssemblyAI submit failed: cannot fetch https://x.blob.core/a.mp3?sig=abc123 today",
      ),
    );
    await requestTranscript(docId);
    const t = await prisma.transcript.findUniqueOrThrow({ where: { documentId: docId } });
    expect(t.error).toBe("AssemblyAI submit failed: cannot fetch [link removed] today");
  });

  test("transcript deleted between claim and submit: provider job is deleted", async () => {
    vi.mocked(submitJob).mockImplementation(async () => {
      await prisma.transcript.deleteMany({ where: { documentId: docId } });
      return { jobId: "orphan-1" };
    });
    vi.mocked(deleteJob).mockResolvedValue(true);
    await requestTranscript(docId);
    expect(deleteJob).toHaveBeenCalledWith("orphan-1");
    expect(await prisma.transcriptPurge.count()).toBe(0);
    expect(await prisma.transcript.count()).toBe(0);
  });

  test("orphaned job whose delete is refused is queued for purge", async () => {
    vi.mocked(submitJob).mockImplementation(async () => {
      await prisma.transcript.deleteMany({ where: { documentId: docId } });
      return { jobId: "orphan-2" };
    });
    vi.mocked(deleteJob).mockResolvedValue(false);
    await requestTranscript(docId);
    const purges = await prisma.transcriptPurge.findMany();
    expect(purges.map((p) => p.providerJobId)).toEqual(["orphan-2"]);
  });

  test("second request while in flight: Already transcribing.", async () => {
    await requestTranscript(docId);
    vi.mocked(submitJob).mockClear();
    expect(await requestTranscript(docId)).toEqual({ ok: false, error: "Already transcribing." });
    expect(submitJob).not.toHaveBeenCalled();
  });

  test("submit failure marks the transcript failed", async () => {
    vi.mocked(submitJob).mockRejectedValue(new Error("AssemblyAI submit failed: nope"));
    const r = await requestTranscript(docId);
    expect(r.ok).toBe(false);
    const t = await prisma.transcript.findUniqueOrThrow({ where: { documentId: docId } });
    expect(t.status).toBe("failed");
    expect(t.error).toContain("nope");
  });

  test("a failed re-run keeps the previous completedAt", async () => {
    const done = new Date("2026-10-02T12:00:00Z");
    await prisma.transcript.create({
      data: {
        documentId: docId,
        status: "completed",
        providerJobId: "old",
        requestedById: userId,
        durationSeconds: 90,
        completedAt: done,
      },
    });
    vi.mocked(submitJob).mockRejectedValue(new Error("down"));
    expect((await requestTranscript(docId)).ok).toBe(false);
    const t = await prisma.transcript.findUniqueOrThrow({ where: { documentId: docId } });
    expect(t.status).toBe("failed");
    expect(t.completedAt).toEqual(done);
    expect(t.durationSeconds).toBe(90);
  });

  describe("corrected transcript", () => {
    beforeEach(async () => {
      await prisma.transcript.create({
        data: {
          documentId: docId,
          status: "completed",
          providerJobId: "old",
          requestedById: userId,
          correctedAt: new Date(),
          correctedById: userId,
        },
      });
    });

    test("needs confirmation", async () => {
      expect(await requestTranscript(docId)).toEqual({
        ok: false,
        needsConfirm: "replace_corrections",
        error: "This replaces the corrections made to the transcript.",
      });
      expect(submitJob).not.toHaveBeenCalled();
    });

    test("proceeds with replaceCorrections", async () => {
      expect(await requestTranscript(docId, { replaceCorrections: true })).toEqual({
        ok: true,
        status: "processing",
      });
      const t = await prisma.transcript.findUniqueOrThrow({ where: { documentId: docId } });
      expect(t.providerJobId).toBe("job-1");
    });
  });

  test("reuses a completed transcript of the same file in the same scope", async () => {
    const other = await audioDoc("blob/a.mp3", "copy.mp3");
    const src = await prisma.transcript.create({
      data: {
        documentId: other,
        status: "completed",
        providerJobId: "src",
        requestedById: userId,
        durationSeconds: 60,
        language: "en_us",
        speakers: { A: "Officer" },
        completedAt: new Date(),
      },
    });
    await prisma.transcriptSegment.create({
      data: {
        transcriptId: src.id,
        index: 0,
        speaker: "A",
        startSeconds: 0,
        endSeconds: 2,
        text: "Hello.",
        words: [{ w: "Hello.", s: 0, e: 1 }],
      },
    });
    expect(await requestTranscript(docId)).toEqual({ ok: true, status: "completed" });
    expect(submitJob).not.toHaveBeenCalled();
    const t = await prisma.transcript.findUniqueOrThrow({
      where: { documentId: docId },
      include: { segments: true },
    });
    expect(t.status).toBe("completed");
    expect(t.provider).toBe("copy");
    expect(t.speakers).toEqual({ A: "Officer" });
    expect(t.durationSeconds).toBe(60);
    expect(t.segments.map((s) => s.text)).toEqual(["Hello."]);
    expect(await prisma.activityLog.count({ where: { title: "Transcript copied" } })).toBe(1);
  });

  async function completedSibling() {
    const other = await audioDoc("blob/a.mp3", "copy.mp3");
    await prisma.transcript.create({
      data: {
        documentId: other,
        status: "completed",
        providerJobId: "src",
        requestedById: userId,
        durationSeconds: 60,
        completedAt: new Date(),
      },
    });
  }

  test("re-running over an existing completed transcript re-runs, never copies a sibling", async () => {
    await completedSibling();
    await prisma.transcript.create({
      data: {
        documentId: docId,
        status: "completed",
        providerJobId: "mine",
        requestedById: userId,
        completedAt: new Date(),
      },
    });
    expect(await requestTranscript(docId)).toEqual({ ok: true, status: "processing" });
    expect(submitJob).toHaveBeenCalledTimes(1);
  });

  test("a failed transcript that never completed may still reuse a sibling", async () => {
    await completedSibling();
    await prisma.transcript.create({
      data: { documentId: docId, status: "failed", requestedById: userId },
    });
    expect(await requestTranscript(docId)).toEqual({ ok: true, status: "completed" });
    expect(submitJob).not.toHaveBeenCalled();
  });

  test("monthly cap refuses and excludes copies", async () => {
    process.env.TRANSCRIPTION_MONTHLY_HOURS = "1";
    const other = await audioDoc("blob/other.mp3", "o.mp3");
    await prisma.transcript.create({
      data: {
        documentId: other,
        status: "completed",
        providerJobId: "u",
        requestedById: userId,
        durationSeconds: 3600,
        completedAt: new Date(),
      },
    });
    expect(await requestTranscript(docId)).toEqual({
      ok: false,
      error: "This month's transcription limit (1 hours) is used up.",
    });
    expect(submitJob).not.toHaveBeenCalled();
    // A copy of the same duration doesn't count.
    await prisma.transcript.update({ where: { documentId: other }, data: { provider: "copy" } });
    expect((await requestTranscript(docId)).ok).toBe(true);
  });
});

describe("deleteTranscript", () => {
  test("requires its permission and scope access, removes the row", async () => {
    await prisma.transcript.create({
      data: { documentId: docId, status: "processing", providerJobId: "j9", requestedById: userId },
    });
    expect(await deleteTranscript(docId)).toEqual({ ok: true });
    expect(requirePermission).toHaveBeenCalledWith("documents.transcript.delete");
    expect(assertChildMatterAccess).toHaveBeenCalledWith("document", docId);
    expect(await prisma.transcript.count()).toBe(0);
    // The DB trigger queues the provider copy; no inline provider call.
    expect(deleteJob).not.toHaveBeenCalled();
    const purges = await prisma.transcriptPurge.findMany();
    expect(purges.map((p) => p.providerJobId)).toEqual(["j9"]);
    expect(await prisma.activityLog.count({ where: { title: "Transcript deleted" } })).toBe(1);
  });

  test("completed row: no purge row", async () => {
    await prisma.transcript.create({
      data: {
        documentId: docId,
        status: "completed",
        providerJobId: "done",
        requestedById: userId,
      },
    });
    await deleteTranscript(docId);
    expect(await prisma.transcriptPurge.count()).toBe(0);
  });

  test("walled: refused, row kept", async () => {
    await prisma.transcript.create({
      data: { documentId: docId, status: "completed", requestedById: userId },
    });
    vi.mocked(assertChildMatterAccess).mockRejectedValue(new Error("NOT_FOUND"));
    await expect(deleteTranscript(docId)).rejects.toThrow("NOT_FOUND");
    expect(await prisma.transcript.count()).toBe(1);
  });
});
