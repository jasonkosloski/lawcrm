/**
 * Turns a stored auth-event `detail` line into something a person can
 * read on /settings/security. Rows are written as
 * `reason — IP x · <user agent>` (src/lib/auth-events.ts) or, from the
 * Clerk webhook, `Session <id>`. The raw line stays in the database for
 * the firm activity log; this only shapes the per-user history.
 */

/** "Chrome on macOS", or null when the agent can't be recognised. */
export function describeUserAgent(ua: string): string | null {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os;
}

/** Internal identifiers that mean nothing to the reader. */
const INTERNAL = [/^Session \S+$/];
/** "Clerk user <id>: " prefix on no_access rows — drop the id, keep the reason. */
const CLERK_PREFIX = /^Clerk user \S+?:\s*/;

export function describeAuthDetail(detail: string | null): string | null {
  if (!detail) return null;
  const parts: string[] = [];
  for (const segment of detail.split(/ — | · /)) {
    const s = segment.trim().replace(CLERK_PREFIX, "");
    if (!s || INTERNAL.some((re) => re.test(s))) continue;
    if (s.startsWith("IP ")) {
      parts.push(s);
    } else if (/^Mozilla\/|AppleWebKit|Gecko\//.test(s)) {
      const agent = describeUserAgent(s);
      if (agent) parts.unshift(agent);
    } else {
      parts.push(s);
    }
  }
  return parts.length ? parts.join(" · ") : null;
}
