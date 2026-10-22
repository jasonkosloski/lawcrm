import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/transcription/assemblyai");

import { prisma } from "@/lib/prisma";
import { deleteJob, fetchJob } from "@/lib/transcription/assemblyai";
import { GET } from "./route";
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
const MIN = 60_000;

function call(auth = true) {
  return GET(
    new Request("http://x/api/transcription-sweep", {
      headers: auth ? { authorization: "Bearer cron-secret" } : {},
    }),
  );
}

async function transcript(opts: {
  status: string;
  ageMs: number;
  jobId: string | null;
}) {
  const { documentId } = await seedDocument({ matterId, contentType: "audio/mpeg" });
  return prisma.transcript.create({
    data: {
      documentId,
      status: opts.status,
      providerJobId: opts.jobId,
      requestedById: userId,
      requestedAt: new Date(Date.now() - opts.ageMs),
    },
  });
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  vi.mocked(deleteJob).mockResolvedValue(true);
  vi.mocked(fetchJob).mockResolvedValue({ status: "processing" });
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId }));
});

describe("transcription sweep", () => {
  test("401 without the cron bearer", async () => {
    expect((await call(false)).status).toBe(401);
    expect(fetchJob).not.toHaveBeenCalled();
  });

  test("selects processing >2 min and stale queued, oldest first, take 25", async () => {
    await transcript({ status: "processing", ageMs: 1 * MIN, jobId: "fresh" });
    await transcript({ status: "completed", ageMs: 60 * MIN, jobId: "done" });
    await transcript({ status: "failed", ageMs: 60 * MIN, jobId: "bad" });
    await transcript({ status: "queued", ageMs: 5 * MIN, jobId: null });
    await transcript({ status: "processing", ageMs: 3 * MIN, jobId: "newer" });
    await transcript({ status: "processing", ageMs: 30 * MIN, jobId: "older" });
    const res = await call();
    expect(res.status).toBe(200);
    expect(vi.mocked(fetchJob).mock.calls.map((c) => c[0])).toEqual(["older", "newer"]);

    vi.mocked(fetchJob).mockClear();
    for (let i = 0; i < 27; i++) {
      await transcript({ status: "processing", ageMs: (100 + i) * MIN, jobId: `j${i}` });
    }
    await call();
    expect(vi.mocked(fetchJob)).toHaveBeenCalledTimes(25);
  });

  test("drains purges before processing jobs", async () => {
    await prisma.transcriptPurge.create({ data: { providerJobId: "purge-me" } });
    await transcript({ status: "processing", ageMs: 30 * MIN, jobId: "job-a" });
    await call();
    const purgeAt = vi.mocked(deleteJob).mock.invocationCallOrder[0];
    const jobAt = vi.mocked(fetchJob).mock.invocationCallOrder[0];
    expect(purgeAt).toBeLessThan(jobAt);
  });

  test("stops picking up new jobs once ~40 s have elapsed", async () => {
    for (let i = 0; i < 6; i++) {
      await transcript({ status: "processing", ageMs: (30 + i) * MIN, jobId: `slow${i}` });
    }
    const real = Date.now();
    let offset = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => real + offset);
    // Each provider call "takes" 15 s.
    vi.mocked(fetchJob).mockImplementation(async () => {
      offset += 15_000;
      return { status: "processing" };
    });
    try {
      const body = await (await call()).json();
      expect(vi.mocked(fetchJob)).toHaveBeenCalledTimes(3);
      expect(body.skipped).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });

  test("recovers a queued row stuck over 10 minutes", async () => {
    const t = await transcript({ status: "queued", ageMs: 11 * MIN, jobId: null });
    const body = await (await call()).json();
    expect(body.failed).toBe(1);
    expect((await prisma.transcript.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("failed");
  });

  test("drains purges: deletes done, increments refused, gives up after 7 days", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await prisma.transcriptPurge.create({ data: { providerJobId: "ok" } });
    await prisma.transcriptPurge.create({ data: { providerJobId: "stuck" } });
    await prisma.transcriptPurge.create({
      data: { providerJobId: "ancient", createdAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    vi.mocked(deleteJob).mockImplementation(async (id) => id === "ok");
    await call();
    const left = await prisma.transcriptPurge.findMany();
    expect(left.map((r) => [r.providerJobId, r.attempts])).toEqual([["stuck", 1]]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("ancient"))).toBe(true);
  });
});
