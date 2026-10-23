/**
 * Spots a filled-in template marks for attention — "[Client address — not
 * on file]", an unknown "{{field}}", an archived, missing, looping or
 * too-deeply nested block. The email composers check the draft for these
 * before sending so a placeholder can't go out by accident. Client-safe.
 */

const PLACEHOLDER_RE =
  /\[[^\]\n]{1,160} — not on file\]|\[[^\]\n]{1,160} block — archived\]|\[Missing block\]|\[Block includes itself\]|\[Blocks nested too deep\]|\{\{[A-Za-z0-9_.]+\}\}/;

export function hasTemplatePlaceholders(text: string): boolean {
  return PLACEHOLDER_RE.test(text);
}

export const PLACEHOLDER_SEND_WARNING =
  "This email still has template placeholders (marked “not on file”). Fix them, or send anyway.";
