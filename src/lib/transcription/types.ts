/** A single transcribed word. Times are seconds from the start of the media. */
export type Word = { w: string; s: number; e: number; c?: number };

export type NormalizedSegment = {
  index: number;
  speaker: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  words: Word[];
};

export type NormalizedResult = {
  language: string | null;
  durationSeconds: number | null;
  speakers: string[];
  segments: NormalizedSegment[];
};

/** Subset of the AssemblyAI v2 completed-transcript response we consume. Times are ms. */
export type AssemblyAIWord = {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: string | null;
};

export type AssemblyAIUtterance = {
  speaker: string;
  start?: number;
  end?: number;
  text?: string;
  confidence?: number;
  words: AssemblyAIWord[];
};

export type AssemblyAITranscript = {
  id?: string;
  status?: string;
  text?: string | null;
  language_code?: string;
  audio_duration?: number | null;
  utterances?: AssemblyAIUtterance[] | null;
  words?: AssemblyAIWord[] | null;
};
