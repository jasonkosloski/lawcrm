import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/assemblyai-completed.json";
import { normalizeAssemblyAI, wordsToText } from "./normalize";
import type { AssemblyAITranscript } from "./types";

const raw = fixture as AssemblyAITranscript;

describe("normalizeAssemblyAI", () => {
  const r = normalizeAssemblyAI(raw);

  it("collects speakers, language, duration", () => {
    expect(r.speakers).toEqual(["A", "B"]);
    expect(r.language).toBe("en_us");
    expect(r.durationSeconds).toBe(144);
  });

  it("converts ms to seconds", () => {
    expect(r.segments[0].startSeconds).toBe(raw.words![0].start / 1000);
    expect(r.segments[0].words[0].c).toBe(0.95);
  });

  it("splits a >90s turn at the last sentence end before 90s", () => {
    expect(r.segments[0].text).toBe(
      "Good morning everyone. Please state your name. I was at the store."
    );
    expect(r.segments[1].text).toBe("Then I left the building.");
    expect(r.segments.map((s) => s.index)).toEqual(r.segments.map((_, i) => i));
    for (const s of r.segments) expect(s.endSeconds - s.startSeconds).toBeLessThanOrEqual(90);
  });

  it("text equals wordsToText(words)", () => {
    for (const s of r.segments) expect(s.text).toBe(wordsToText(s.words));
  });

  it("without utterances builds one speaker A from words", () => {
    const x = normalizeAssemblyAI({ words: raw.words, language_code: "en" });
    expect(x.speakers).toEqual(["A"]);
    expect(x.segments.length).toBeGreaterThan(0);
    expect(x.segments.every((s) => s.speaker === "A")).toBe(true);
    expect(x.durationSeconds).toBeNull();
  });

  it("zero words gives no segments", () => {
    const x = normalizeAssemblyAI({ words: [], utterances: [] });
    expect(x.segments).toEqual([]);
    expect(x.speakers).toEqual([]);
  });
});
