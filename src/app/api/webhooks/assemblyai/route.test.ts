import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/transcription/assemblyai", () => ({
  WEBHOOK_SECRET_HEADER: "x-transcript-secret",
  fetchJob: vi.fn(),
  deleteJob: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { fetchJob } from "@/lib/transcription/assemblyai";
import { POST } from "./route";
import {
  resetDb,
  seedDocument,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let transcriptId: string;

function req(body: unknown, secret?: string) {
  return new Request("http://x/api/webhooks/assemblyai", {
    method: "POST",
    headers: secret ? { "x-transcript-secret": secret } : {},
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId });
  const { areaId, stageId } = await seedPracticeArea();
  const { matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId });
  const { documentId } = await seedDocument({ matterId, contentType: "audio/mpeg" });
  const t = await prisma.transcript.create({
    data: {
      documentId,
      status: "processing",
      providerJobId: "job-new",
      webhookSecret: "sec",
      requestedById: userId,
    },
  });
  transcriptId = t.id;
  vi.mocked(fetchJob).mockResolvedValue({
    status: "completed",
    raw: { id: "x", status: "completed", words: [], audio_duration: 5 },
  });
});

describe("assemblyai webhook", () => {
  test("wrong secret: 401, nothing written", async () => {
    const res = await POST(req({ transcript_id: "job-new" }, "nope") as never);
    expect(res.status).toBe(401);
    expect(fetchJob).not.toHaveBeenCalled();
  });

  test("missing secret: 401", async () => {
    const res = await POST(req({ transcript_id: "job-new" }) as never);
    expect(res.status).toBe(401);
  });

  test("right secret finishes the job", async () => {
    const res = await POST(req({ transcript_id: "job-new" }, "sec") as never);
    expect(res.status).toBe(200);
    expect((await prisma.transcript.findUniqueOrThrow({ where: { id: transcriptId } })).status).toBe("completed");
  });

  test("repeat webhook on a completed transcript: 200, no writes", async () => {
    await POST(req({ transcript_id: "job-new" }, "sec") as never);
    vi.mocked(fetchJob).mockClear();
    const res = await POST(req({ transcript_id: "job-new" }, "sec") as never);
    expect(res.status).toBe(200);
    expect(fetchJob).not.toHaveBeenCalled();
  });

  test("stale/unknown job id (re-run replaced it): 200, nothing written", async () => {
    const res = await POST(req({ transcript_id: "job-old" }, "sec") as never);
    expect(res.status).toBe(200);
    expect(fetchJob).not.toHaveBeenCalled();
    expect((await prisma.transcript.findUniqueOrThrow({ where: { id: transcriptId } })).status).toBe("processing");
  });

  test("malformed body: 200 no-op", async () => {
    const res = await POST(
      new Request("http://x", { method: "POST", body: "not json" }) as never,
    );
    expect(res.status).toBe(200);
  });
});
