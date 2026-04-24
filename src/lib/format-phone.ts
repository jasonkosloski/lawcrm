/**
 * Phone number display formatter.
 *
 * Normalizes any US-ish phone input to `(xxx) xxx-xxxx` for display.
 * Storage stays raw — users can type whatever format they want,
 * paste from email signatures, etc. — and we format at render time.
 *
 * Rules:
 *   - Strip everything that isn't a digit
 *   - Exactly 10 digits  → "(XXX) XXX-XXXX"
 *   - 11 digits starting with 1 (country code) → strip the 1, format
 *   - Anything else → return the original string unchanged (so
 *     non-US numbers, extensions, "555-EATS" and partial entries
 *     don't get mangled)
 */

export function formatPhone(
  raw: string | null | undefined
): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return raw;
}
