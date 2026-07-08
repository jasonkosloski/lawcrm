/**
 * Email signature seam (Email v1.1).
 *
 * v1 deliberately appends NOTHING automatic — this exists so
 * per-user signatures are a clean follow-up instead of a composer
 * rewrite. The compose / reply composers seed their editor's initial
 * HTML from here (and reset back to it after a successful send).
 *
 * Follow-up shape: make this async, look up the current user's
 * stored signature HTML (Settings → Profile), run it through
 * `sanitizeUserHtml`, and return e.g. `<p></p><p>—</p>` + signature
 * so the caret starts above it. Callers already treat the return
 * value as editor-ready HTML, so only this function changes.
 */
export function getEmailSignature(): string | null {
  return null;
}
