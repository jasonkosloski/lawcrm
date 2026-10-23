/**
 * The one link rule for email, used by the outgoing sanitizer, the Email
 * preset and the link control: absolute http(s), mailto or tel. No
 * imports, so the server sanitizer and client editor can both use it.
 */
export function isAllowedEmailLink(url: string): boolean {
  return /^(https?:\/\/[^/]|mailto:.|tel:.)/i.test(url.replace(/[\u0000- ]/g, ""));
}
