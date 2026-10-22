import { escapeHtml } from "@/lib/email/escape";

/**
 * Plain text -> HTML for note bodies typed into a bare <textarea>
 * (sibling-note captures, the "Add note on this task" dialogs).
 *
 * Run through the HTML sanitizer instead, such text loses its line
 * breaks (HTML collapses raw newlines) and anything in angle brackets
 * ("Re: <Smith> deposition") is eaten as an unknown tag. Escape first,
 * THEN turn newlines into <br> - the other order would escape the <br>.
 * The result is sanitizer-shaped by construction.
 */
export function textareaToHtml(raw: string): string {
  return escapeHtml(raw).replace(/\r?\n/g, "<br>");
}

/**
 * Plain text -> paragraph HTML: blank-line-separated blocks become
 * `<p>`, single newlines become `<br>`, everything escaped. Empty or
 * whitespace-only input returns "". Used for outgoing plain-text email,
 * text/plain Gmail bodies and inbox note captures.
 */
export function paragraphsToHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
