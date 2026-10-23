/** The one link rule for email: absolute http(s) or mailto (matches the outgoing sanitizer). */
export function isAllowedEmailLink(url: string): boolean {
  return /^(https?:\/\/[^/]|mailto:.)/i.test(url.replace(/[\u0000- ]/g, ""));
}
