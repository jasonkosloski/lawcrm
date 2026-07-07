/**
 * Slug-label display formatter.
 *
 * Email-thread labels (and other tag-like slugs) are stored as
 * lowercase snake_case — "privileged_label", "opposing_counsel",
 * "custom:fee_dispute" — but should read as human text in the UI:
 * "Privileged", "Opposing Counsel", "Fee Dispute".
 *
 * Rules:
 *   - Strip a "custom:" namespace prefix
 *   - Strip a redundant "_label" / "-label" suffix
 *   - Split on underscores / hyphens, title-case each word
 *   - Unknown / already-clean input passes through title-cased,
 *     so a raw slug never reaches the screen
 */

export function formatEmailLabel(raw: string | null | undefined): string {
  if (!raw) return "";
  let slug = raw.trim();
  // Namespace prefixes ("custom:foo_bar") — keep only the tail.
  const colon = slug.lastIndexOf(":");
  if (colon !== -1) slug = slug.slice(colon + 1);
  // Redundant "_label" suffix ("privileged_label" → "privileged").
  slug = slug.replace(/[_-]label$/i, "");
  const words = slug.split(/[_\-\s]+/).filter(Boolean);
  return words
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
