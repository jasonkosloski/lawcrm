/**
 * EmailMessage.body carries two shapes that must render differently:
 *
 *   - Gmail-synced / CRM-sent messages: sanitized HTML. Two writers
 *     produce it, both allowlist sanitizers: `sanitizeEmailHtml` at
 *     the Gmail sync boundary and `sanitizeOutgoingEmailHtml` /
 *     `plainTextToHtml` at the CRM send boundary (actions/email-send).
 *     Rendering it via dangerouslySetInnerHTML is safe by
 *     construction.
 *   - Legacy / seeded messages: plain text - must keep the
 *     pre-wrap text path (HTML rendering would collapse newlines).
 *
 * The discriminator is deliberately dumb and errs toward HTML:
 * sanitized HTML usually starts with an element, but NOT always -
 * the sanitizer discards disallowed wrappers (html/body/font) and
 * keeps their text, so a body can begin with bare text
 * ("Hello AT&amp;T,<br />..."). So a body also counts as HTML when
 * it contains any well-formed tag or an HTML character reference.
 * Sanitizer output escapes every literal `&` and `<` in text, so
 * a raw "<" can only be a tag, whereas human plain text essentially
 * never contains either. `<name@host>` (an address in angle
 * brackets) is not a tag: the `@` stops the tag-name match.
 */
const TAG_RE = /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/i;
const ENTITY_RE = /&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/i;

export function isHtmlEmailBody(body: string): boolean {
  if (body.trimStart().startsWith("<")) return true;
  return TAG_RE.test(body) || ENTITY_RE.test(body);
}
