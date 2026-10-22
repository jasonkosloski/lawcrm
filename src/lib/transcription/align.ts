import type { Word } from "./types";

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Re-time an edited paragraph. Tokens that match the old words (case and
 * punctuation insensitive, via LCS) keep the old timings with the new
 * spelling; runs of new tokens are spread evenly between their matched
 * neighbours; deleted words drop.
 */
export function alignWords(old: Word[], newText: string): Word[] {
  const tokens = newText.split(/\s+/).filter(Boolean);
  const a = old.map((o) => norm(o.w));
  const b = tokens.map(norm);
  const n = a.length;
  const m = b.length;

  // LCS table (suffix form so we can walk forward).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: Word[] = [];
  // Unmatched new tokens waiting for the next anchor.
  let pending: string[] = [];
  let prevEnd: number | null = null; // end of the last matched old word
  // Span of old words dropped/replaced in the current gap, if any.
  let skipped: { s: number; e: number } | null = null;

  const flush = (nextStart: number | null) => {
    if (pending.length === 0) return;
    // A replaced span lends its own timing; otherwise use the gap between anchors.
    const from = skipped ? skipped.s : (prevEnd ?? old[0]?.s ?? 0);
    const to = skipped ? skipped.e : (nextStart ?? old[old.length - 1]?.e ?? from);
    const leading = prevEnd === null && !skipped;
    const lo = Math.min(from, to);
    const step = (to - lo) / pending.length;
    // Leading insertion has zero width at the first word's start.
    const width = leading ? 0 : step;
    pending.forEach((t, k) => {
      if (leading) out.push({ w: t, s: from, e: from });
      else out.push({ w: t, s: lo + k * width, e: lo + (k + 1) * width });
    });
    pending = [];
  };
  const resetGap = () => {
    skipped = null;
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush(old[i].s);
      const kept: Word = { ...old[i], w: tokens[j] };
      out.push(kept);
      prevEnd = old[i].e;
      resetGap();
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      skipped = { s: skipped ? skipped.s : old[i].s, e: old[i].e };
      i++; // old word deleted/replaced
    } else {
      pending.push(tokens[j]);
      j++;
    }
  }
  while (j < m) pending.push(tokens[j++]);
  flush(null);
  return out;
}
