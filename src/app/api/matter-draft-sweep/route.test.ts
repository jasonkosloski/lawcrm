// @vitest-environment node

/**
 * Matter-draft sweep cron: auth gate, 90-day cutoff, and best-effort
 * file cleanup. Runs against the real test DB; file storage is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/file-storage", () => ({ deleteFile: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/file-storage";
import { MATTER_DRAFT_RETENTION_DAYS } from "@/lib/draft-access";
import { GET } from "./route";

const mockedDelete = vi.mocked(deleteFile);
const savedSecret = process.env.CRON_SECRET;
const DAY = 86_400_000;

const request = (auth?: string): Request =>
  new Request("https://app.example/api/matter-draft-sweep", {
    headers: auth === undefined ? {} : { authorization: auth },
  });

async function makeDraft(ageDays: number, keys: string[]) {
  const user = await prisma.user.create({
    data: {
      email: `sweep-${Math.random().toString(36).slice(2)}@example.test`,
      name: "Sweep Tester",
      initials: "ST",
      jobTitle: "Attorney",
    },
  });
  const draft = await prisma.matterDraft.create({
    data: {
      createdById: user.id,
      values: {},
      files: { create: keys.map((k) => ({ name: k, fileUrl: k, uploadedBy: user.id })) },
    },
  });
  // updatedAt is @updatedAt; force it with raw SQL.
  await prisma.$executeRaw`UPDATE matter_drafts SET "updatedAt" = ${new Date(
    Date.now() - ageDays * DAY
  )} WHERE id = ${draft.id}`;
  return draft;
}

beforeEach(async () => {
  await prisma.matterDraft.deleteMany();
  mockedDelete.mockReset();
  mockedDelete.mockResolvedValue(undefined as never);
  process.env.CRON_SECRET = "s3cret";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

describe("GET /api/matter-draft-sweep", () => {
  it("401s without the exact bearer and deletes nothing", async () => {
    const d = await makeDraft(MATTER_DRAFT_RETENTION_DAYS + 1, ["k-old"]);
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(request("Bearer undefined"))).status).toBe(401);
    expect(await prisma.matterDraft.count({ where: { id: d.id } })).toBe(1);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it("deletes a 91-day draft and its files, keeps an 89-day one", async () => {
    const old = await makeDraft(91, ["old-1", "old-2"]);
    const fresh = await makeDraft(89, ["fresh-1"]);
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });
    expect(await prisma.matterDraft.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.matterDraft.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(mockedDelete.mock.calls.map((c) => c[0]).sort()).toEqual(["old-1", "old-2"]);
  });

  it("a storage failure does not abort the rest", async () => {
    await makeDraft(100, ["bad", "good"]);
    await makeDraft(100, ["other"]);
    mockedDelete.mockImplementation(async (key: string) => {
      if (key === "bad") throw new Error("boom");
    });
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(mockedDelete).toHaveBeenCalledTimes(3);
    expect(await prisma.matterDraft.count()).toBe(0);
  });
});
