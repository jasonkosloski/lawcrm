import { describe, expect, test } from "vitest";
import type { TranscriptView } from "@/lib/queries/transcript";
import { exportNotice, toTranscriptExport } from "./export";

const view = (over: Partial<TranscriptView> = {}): TranscriptView => ({
  id: "t1",
  status: "completed",
  error: null,
  durationSeconds: 900,
  completedAt: new Date("2026-10-01T15:00:00Z"),
  correctedAt: null,
  correctedByName: null,
  speakers: { A: "Officer Diaz" },
  segments: [
    { id: "s1", index: 0, speaker: "A", startSeconds: 252.7, endSeconds: 260, text: "Hello.", words: [], originalText: null, revision: 0 },
    { id: "s2", index: 1, speaker: "B", startSeconds: 3725, endSeconds: 3730, text: "Hi.", words: [], originalText: null, revision: 0 },
  ],
  ...over,
});

describe("toTranscriptExport", () => {
  test("maps speaker names and [hh:mm:ss] timecodes", () => {
    const e = toTranscriptExport(view(), { caption: "Alvarez v. City", documentName: "bodycam.mp4" });
    expect(e.paragraphs).toEqual([
      { speaker: "Officer Diaz", timecode: "[00:04:12]", text: "Hello." },
      { speaker: "Speaker B", timecode: "[01:02:05]", text: "Hi." },
    ]);
    expect(e.caption).toBe("Alvarez v. City");
    expect(e.durationSeconds).toBe(900);
    expect(e.corrected).toBeNull();
  });

  test("corrected vs uncorrected notice", () => {
    const at = new Date("2026-10-02T00:00:00Z");
    const c = toTranscriptExport(view({ correctedAt: at, correctedByName: "Jo" }), { caption: "", documentName: "d" });
    expect(c.corrected).toEqual({ by: "Jo", at });
    expect(exportNotice(c)).toBe("Machine transcript, corrected by staff");
    expect(exportNotice(toTranscriptExport(view(), { caption: "", documentName: "d" }))).toBe(
      "Uncorrected machine transcript",
    );
  });
});
