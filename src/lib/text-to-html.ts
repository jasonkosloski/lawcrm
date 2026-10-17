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
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\r?\n/g, "<br>");
}
