import type { Word } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

function parts(seconds: number) {
  const t = Math.max(0, Math.floor(seconds));
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

/** "00:04:12" */
export function formatTimecode(seconds: number): string {
  const { h, m, s } = parts(seconds);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** "4:12" under an hour, "1:04:12" over. */
export function formatShortTimecode(seconds: number): string {
  const { h, m, s } = parts(seconds);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Index of the last word with `s <= t`; -1 before the first word. */
export function activeWordIndex(words: Word[], t: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].s <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
