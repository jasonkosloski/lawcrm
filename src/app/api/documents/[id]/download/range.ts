/**
 * HTTP Range header resolution (RFC 9110 §14) for the download
 * route. Single-range only — multi-range (`bytes=0-1,5-9`) responses
 * need `multipart/byteranges` framing that no media element ever
 * asks for, so we lawfully ignore those and serve the full body
 * (an origin server MAY ignore the Range header).
 *
 * Kept as a pure function so the byte math (inclusive ends,
 * suffix-range arithmetic, clamping) is testable without wiring up
 * the whole route.
 */

export type ResolvedRange =
  /** No/unusable Range header — serve the whole file as 200. */
  | { kind: "full" }
  /** Serve bytes [start, end] (both inclusive) as 206. */
  | { kind: "partial"; start: number; end: number }
  /** No overlap with the file — 416 with `Content-Range: bytes *​/size`. */
  | { kind: "unsatisfiable" };

/**
 * Resolve a raw `Range` request header against a file of `size`
 * bytes.
 *
 * Grammar handled: `bytes=<start>-<end>`, `bytes=<start>-` (open
 * ended), `bytes=-<suffix>` (last N bytes). Per spec, malformed or
 * backwards ranges are ignored (200 full) — only a syntactically
 * valid range that lies wholly past EOF is a 416.
 */
export function resolveRangeHeader(
  header: string | null,
  size: number
): ResolvedRange {
  if (!header) return { kind: "full" };

  const unitMatch = /^bytes=(.*)$/i.exec(header.trim());
  // Unknown range unit → MUST ignore (RFC 9110 §14.2).
  if (!unitMatch) return { kind: "full" };

  const spec = unitMatch[1].trim();
  // Multi-range — see module docblock.
  if (spec.includes(",")) return { kind: "full" };

  const m = /^(\d*)-(\d*)$/.exec(spec);
  if (!m) return { kind: "full" };
  const [, startStr, endStr] = m;

  // "bytes=-" has neither bound — malformed, ignore.
  if (startStr === "" && endStr === "") return { kind: "full" };

  // Suffix form: last N bytes.
  if (startStr === "") {
    const n = Number(endStr);
    if (!Number.isSafeInteger(n)) return { kind: "full" };
    // A zero-length suffix (or any range against an empty file)
    // can never be satisfied.
    if (n === 0 || size === 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - n), end: size - 1 };
  }

  const start = Number(startStr);
  if (!Number.isSafeInteger(start)) return { kind: "full" };
  // First byte past EOF (covers size === 0 for any start).
  if (start >= size) return { kind: "unsatisfiable" };

  if (endStr === "") return { kind: "partial", start, end: size - 1 };

  const end = Number(endStr);
  if (!Number.isSafeInteger(end)) return { kind: "full" };
  // Backwards range is malformed — ignore, don't 416.
  if (end < start) return { kind: "full" };

  // An end past EOF is fine; it means "through the last byte".
  return { kind: "partial", start, end: Math.min(end, size - 1) };
}
