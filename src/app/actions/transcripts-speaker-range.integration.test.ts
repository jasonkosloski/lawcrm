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
import { requirePermission } from "@/lib/permission-check";
import { assertChildMatterAccess } from "@/lib/matter-access";
import { changeSpeakerForSelection, updateTranscriptSegment } from "@/app/actions/transcripts";
import {
  resetDb,
  seedDocument,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let transcriptId: string;
const ids: string[] = [];

const words = (text: string, t0: number) =>
  text.split(" ").map((w, i) => ({ w, s: t0 + i, e: t0 + i + 0.5 }));

/** Three paragraphs: A "one two three four", B "five six", A "seven eight". */
async function seedTranscript() {
  const t = await prisma.transcript.create({
    data: {
      documentId: (await prisma.document.findFirstOrThrow()).id,
      status: "completed",
      requestedById: userId,
      speakers: { A: "Officer", B: "Driver" },
    },
  });
  transcriptId = t.id;
  ids.length = 0;
  const rows: [string, string, number][] = [
    ["A", "one two three four", 0],
    ["B", "five six", 10],
    ["A", "seven eight", 20],
  ];
  for (const [i, [speaker, text, t0]] of rows.entries()) {
    const w = words(text, t0);
    const s = await prisma.transcriptSegment.create({
      data: {
        transcriptId,
        index: i,
        speaker,
        startSeconds: w[0]!.s,
        endSeconds: w[w.length - 1]!.e,
        text,
        words: w,
      },
    });
    ids.push(s.id);
  }
}

const paragraphs = async () =>
  (
    await prisma.transcriptSegment.findMany({
      where: { transcriptId },
      orderBy: { index: "asc" },
    })
  ).map((s) => ({
    index: s.index,
    speaker: s.speaker,
    text: s.text,
    id: s.id,
    revision: s.revision,
  }));

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
  const { matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId });
  await seedDocument({ matterId, name: "a.mp4", contentType: "video/mp4" });
  await seedTranscript();
});

describe("changeSpeakerForSelection", () => {
  test("splits a paragraph, shifts later indices, keeps untouched rows", async () => {
    const r = await changeSpeakerForSelection(transcriptId, {
      start: { segmentId: ids[0]!, word: 1 },
      end: { segmentId: ids[0]!, word: 2 },
      speaker: "B",
      revisions: { [ids[0]!]: 0 },
    });
    expect(r).toEqual({ ok: true });
    expect(requirePermission).toHaveBeenCalledWith("documents.transcript.edit");
    const p = await paragraphs();
    expect(p.map((x) => `${x.index}:${x.speaker}:${x.text}`)).toEqual([
      "0:A:one",
      "1:B:two three",
      "2:A:four",
      "3:B:five six",
      "4:A:seven eight",
    ]);
    // Untouched paragraphs keep their identity.
    expect(p[3]!.id).toBe(ids[1]);
    expect(p[4]!.id).toBe(ids[2]);
    const t = await prisma.transcript.findUniqueOrThrow({ where: { id: transcriptId } });
    expect(t.correctedById).toBe(userId);
    expect(await prisma.activityLog.count({ where: { title: "Transcript speaker changed" } })).toBe(
      1,
    );
  });

  test("relabelling a middle paragraph merges its neighbours and closes the gap", async () => {
    const r = await changeSpeakerForSelection(transcriptId, {
      start: { segmentId: ids[1]!, word: 0 },
      end: { segmentId: ids[1]!, word: 1 },
      speaker: "A",
      revisions: { [ids[1]!]: 0 },
    });
    expect(r).toEqual({ ok: true });
    const p = await paragraphs();
    expect(p.map((x) => `${x.index}:${x.speaker}:${x.text}`)).toEqual([
      "0:A:one two three four five six seven eight",
    ]);
  });

  test("a new speaker label is added to the map", async () => {
    await changeSpeakerForSelection(transcriptId, {
      start: { segmentId: ids[2]!, word: 0 },
      end: { segmentId: ids[2]!, word: 1 },
      speaker: "C",
      revisions: { [ids[2]!]: 0 },
    });
    const t = await prisma.transcript.findUniqueOrThrow({ where: { id: transcriptId } });
    expect(t.speakers).toMatchObject({ A: "Officer", B: "Driver", C: "Speaker C" });
  });

  test("a paragraph edited since the client loaded it → conflict, nothing applied", async () => {
    await updateTranscriptSegment(ids[0]!, { text: "one two three four", revision: 0 }); // revision → 1
    const before = await paragraphs();
    const r = await changeSpeakerForSelection(transcriptId, {
      start: { segmentId: ids[0]!, word: 0 },
      end: { segmentId: ids[1]!, word: 0 },
      speaker: "B",
      revisions: { [ids[0]!]: 0, [ids[1]!]: 0 },
    });
    expect(r).toMatchObject({ ok: false, conflict: true });
    expect(await paragraphs()).toEqual(before);
  });

  test("every covered paragraph needs a revision, not just the ends", async () => {
    const r = await changeSpeakerForSelection(transcriptId, {
      start: { segmentId: ids[0]!, word: 0 },
      end: { segmentId: ids[2]!, word: 0 },
      speaker: "B",
      revisions: { [ids[0]!]: 0, [ids[2]!]: 0 },
    });
    expect(r).toMatchObject({ ok: false, conflict: true });
  });

  test("refused when the transcript isn't completed, or the label is bogus", async () => {
    await prisma.transcript.update({ where: { id: transcriptId }, data: { status: "queued" } });
    const sel = {
      start: { segmentId: ids[0]!, word: 0 },
      end: { segmentId: ids[0]!, word: 0 },
      revisions: { [ids[0]!]: 0 },
    };
    expect(await changeSpeakerForSelection(transcriptId, { ...sel, speaker: "B" })).toMatchObject({
      ok: false,
    });
    await prisma.transcript.update({ where: { id: transcriptId }, data: { status: "completed" } });
    expect(await changeSpeakerForSelection(transcriptId, { ...sel, speaker: "bob" })).toEqual({
      ok: false,
      error: "Unknown speaker.",
    });
  });

  test("checks access on the transcript's document", async () => {
    vi.mocked(assertChildMatterAccess).mockRejectedValueOnce(new Error("walled"));
    await expect(
      changeSpeakerForSelection(transcriptId, {
        start: { segmentId: ids[0]!, word: 0 },
        end: { segmentId: ids[0]!, word: 0 },
        speaker: "B",
        revisions: { [ids[0]!]: 0 },
      }),
    ).rejects.toThrow("walled");
    expect((await paragraphs()).length).toBe(3);
  });

  test("a corrected paragraph relabelled whole keeps its id, original and history", async () => {
    await updateTranscriptSegment(ids[1]!, { text: "five sixx", revision: 0 }); // originalText "five six", rev 1
    const r = await changeSpeakerForSelection(transcriptId, {
      start: { segmentId: ids[1]!, word: 0 },
      end: { segmentId: ids[1]!, word: 1 },
      speaker: "C",
      revisions: { [ids[1]!]: 1 },
    });
    expect(r).toEqual({ ok: true });
    const row = await prisma.transcriptSegment.findUniqueOrThrow({ where: { id: ids[1]! } });
    expect(row).toMatchObject({
      speaker: "C",
      text: "five sixx",
      originalText: "five six",
      revision: 2,
    });
  });

  test("whole paragraphs merged keep the first id and join their originals", async () => {
    await updateTranscriptSegment(ids[2]!, { text: "seven ate", revision: 0 }); // original "seven eight"
    await changeSpeakerForSelection(transcriptId, {
      start: { segmentId: ids[1]!, word: 0 },
      end: { segmentId: ids[1]!, word: 1 },
      speaker: "A",
      revisions: { [ids[1]!]: 0 },
    });
    const p = await prisma.transcriptSegment.findMany({
      where: { transcriptId },
      orderBy: { index: "asc" },
    });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({
      id: ids[0],
      speaker: "A",
      text: "one two three four five six seven ate",
      originalText: "one two three four five six seven eight",
    });
  });

  test("an editor open on a paragraph that was merged away gets a conflict, not a dead end", async () => {
    await changeSpeakerForSelection(transcriptId, {
      start: { segmentId: ids[1]!, word: 0 },
      end: { segmentId: ids[1]!, word: 1 },
      speaker: "A",
      revisions: { [ids[1]!]: 0 },
    });
    const r = await updateTranscriptSegment(ids[2]!, { text: "seven nine", revision: 0 });
    expect(r).toMatchObject({ ok: false, conflict: true });
  });

  test("malformed input is refused cleanly", async () => {
    const r = await changeSpeakerForSelection(transcriptId, {
      start: null,
      end: { segmentId: ids[0]!, word: 0 },
      speaker: "B",
      revisions: {},
    } as never);
    expect(r).toEqual({ ok: false, error: "Invalid selection." });
  });
});
