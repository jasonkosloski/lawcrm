/**
 * Avatar initials for a contact name: first letter of the first two
 * words, upper-cased; "?" for an unknown / blank name. Shared by the
 * messenger list and reader so the two avatars can't drift.
 */
export function contactInitials(name: string | null | undefined): string {
  return (
    (name ?? "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
