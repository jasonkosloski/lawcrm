/**
 * Phone number display formatter.
 *
 * Normalizes any US-ish phone input to `(xxx) xxx-xxxx` for display.
 * Storage stays raw — users can type whatever format they want,
 * paste from email signatures, etc. — and we format at render time.
 *
 * Rules:
 *   - Anything containing a letter (extensions "ext. 123" / "x123",
 *     vanity "555-EATS") is returned unchanged
 *   - A leading "+" must be the NANP country code: "+1" + 10 digits
 *     is formatted; any other country code ("+32 2 123 45 67") is
 *     returned unchanged
 *   - Otherwise strip everything that isn't a digit:
 *       exactly 10 digits  → "(XXX) XXX-XXXX"
 *       11 digits starting with 1 (country code) → strip the 1, format
 *   - Anything else → return the original string unchanged (so
 *     non-US numbers and partial entries don't get mangled)
 *
 * Why the first two: a 10-digit total is not proof of a US number. A
 * 7-digit local number plus a 3-digit extension, or a Belgian
 * "+32 2 123 45 67", also has 10 digits and used to be shown as a
 * wrong-but-dialable US number.
 */

export function formatPhone(
  raw: string | null | undefined
): string {
  if (!raw) return "";
  if (/[a-z]/i.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) {
    if (digits.length === 11 && digits.startsWith("1")) {
      return formatTen(digits.slice(1));
    }
    return raw;
  }
  if (digits.length === 10) return formatTen(digits);
  if (digits.length === 11 && digits.startsWith("1")) {
    return formatTen(digits.slice(1));
  }
  return raw;
}

function formatTen(d: string): string {
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
