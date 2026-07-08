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
 * The discriminator is deliberately dumb: sanitized HTML always
 * starts with an element (the sanitizer emits tags, never leading
 * text), while human plain text essentially never starts with "<".
 * A plain-text body that DID start with "<" would render escaped
 * before this existed and renders as (sanitizer-shaped) markup
 * after — acceptable for a shape that doesn't occur in practice.
 */
export function isHtmlEmailBody(body: string): boolean {
  return body.trimStart().startsWith("<");
}
