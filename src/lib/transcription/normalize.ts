import type {
  AssemblyAITranscript,
  AssemblyAIWord,
  NormalizedResult,
  NormalizedSegment,
  Word,
} from "./types";

/** Segments longer than this are split at a sentence end. */
export const MAX_SEGMENT_SECONDS = 90;

export function wordsToText(words: Word[]): string {
  return words.map((w) => w.w).join(" ");
}

const SENTENCE_END = /[.?!]["')\]]*$/;

function toWord(w: AssemblyAIWord): Word {
  return { w: w.text, s: w.start / 1000, e: w.end / 1000, c: w.confidence };
}

/** Split one speaker turn into <= ~90 s chunks, preferring sentence ends. */
export function splitTurn(words: Word[]): Word[][] {
  const out: Word[][] = [];
  let rest = words;
  while (rest.length > 0) {
    const start = rest[0].s;
    if (rest[rest.length - 1].e - start <= MAX_SEGMENT_SECONDS) {
      out.push(rest);
      break;
    }
    let cut = -1; // last sentence end within the cap
    let lastWithin = -1; // fallback: last word within the cap
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].e - start > MAX_SEGMENT_SECONDS) break;
      lastWithin = i;
      if (SENTENCE_END.test(rest[i].w)) cut = i;
    }
    if (cut < 0) cut = lastWithin;
    if (cut < 0) cut = 0; // a single word longer than the cap
    out.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  return out;
}

export function normalizeAssemblyAI(raw: AssemblyAITranscript): NormalizedResult {
  const turns: { speaker: string; words: Word[] }[] = [];
  const utterances = (raw.utterances ?? []).filter((u) => u.words?.length);
  if (utterances.length > 0) {
    for (const u of utterances) {
      turns.push({ speaker: u.speaker || "A", words: u.words.map(toWord) });
    }
  } else if (raw.words && raw.words.length > 0) {
    turns.push({ speaker: "A", words: raw.words.map(toWord) });
  }

  const segments: NormalizedSegment[] = [];
  const speakers: string[] = [];
  for (const turn of turns) {
    if (!speakers.includes(turn.speaker)) speakers.push(turn.speaker);
    for (const chunk of splitTurn(turn.words)) {
      segments.push({
        index: segments.length,
        speaker: turn.speaker,
        startSeconds: chunk[0].s,
        endSeconds: chunk[chunk.length - 1].e,
        text: wordsToText(chunk),
        words: chunk,
      });
    }
  }

  return {
    language: raw.language_code ?? null,
    durationSeconds: typeof raw.audio_duration === "number" ? raw.audio_duration : null,
    speakers,
    segments,
  };
}
