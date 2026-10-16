/**
 * Strict same-origin redirect-target sanitiser — shared by the
 * /login page (GET, `redirect(next)`) and `loginAction` (POST,
 * `signIn({ redirectTo })`). It lives in a plain module because a
 * `"use server"` file may only export async functions.
 *
 * Browsers parse `Location` with the WHATWG URL algorithm, which
 * treats `\` as `/` and silently strips tab/CR/LF, so `/\evil.example`
 * and `/<TAB>/evil.example` both resolve off-site even though they
 * start with a single "/". Rules (all must hold, else "/"):
 *   - starts with exactly one "/" (not "//")
 *   - no backslash anywhere
 *   - no control characters (incl. tab, CR, LF, DEL) anywhere
 *   - resolving against a dummy origin stays on that origin
 * Returns the raw string (path + query + hash) when it is safe, so
 * proxy-built `?next=/matters/x?tab=y` links round-trip unchanged.
 */

const DUMMY_ORIGIN = "http://x";
const FORBIDDEN_CHARS = /[\\\u0000-\u001f\u007f]/;

export function safeRedirectPath(raw: string | undefined | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (FORBIDDEN_CHARS.test(raw)) return "/";
  try {
    if (new URL(raw, DUMMY_ORIGIN).origin !== DUMMY_ORIGIN) return "/";
  } catch {
    return "/";
  }
  return raw;
}
