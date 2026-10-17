/**
 * EmailMessage.body carries two shapes that must render differently:
 *
 *   - Gmail-synced / CRM-sent messages: sanitized HTML — written
 *     through sanitizeEmailHtml at the sync/send boundary, so
 *     rendering it via dangerouslySetInnerHTML is safe by
 *     construction.
 *   - Legacy / seeded messages: plain text — must keep the
 *     pre-wrap text path (HTML rendering would collapse newlines).
 *
 * The discriminator is deliberately dumb: sanitized HTML usually
 * starts with an element (and when it starts with bare text, a known
 * tag appears later - see KNOWN_TAG_RE), while human plain text
 * essentially never starts with "<".
 * A plain-text body that DID start with "<" would render escaped
 * before this existed and renders as (sanitizer-shaped) markup
 * after — acceptable for a shape that doesn't occur in practice.
 */
export function isHtmlEmailBody(body: string): boolean {
  if (body.trimStart().startsWith("<")) return true;
  // Sanitized HTML CAN start with a bare text run ("Hello<br>...",
  // a synced body whose first node is text) - without this it would
  // render as literal markup. A known tag anywhere is a reliable
  // signal; plain text with a bare "<" (e.g. "a < b") still isn't one.
  return KNOWN_TAG_RE.test(body);
}

const KNOWN_TAG_RE =
  /<\/?(?:p|div|br|span|a|b|i|u|strong|em|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|h[1-6]|pre|code|img|hr|font|center|small|sup|sub|caption|tfoot|colgroup|col)(?:\s[^<>]*)?\/?>/i;
