/**
 * Password policy for passwords a user chooses themselves (change
 * password today; password reset when email delivery lands).
 *
 * Deliberately simple, per NIST SP 800-63B: length is what matters,
 * composition rules ("one symbol, one digit…") are not required.
 *   - 12+ characters
 *   - ≤ 256 characters (argon2 cost scales with input — cap it so a
 *     megabyte "password" can't be used to burn CPU)
 *   - not the account's email address (case-insensitive)
 *
 * "Must differ from the current password" needs the stored hash, so
 * the action checks that separately.
 *
 * Client-safe: no server imports, so the form can show the same
 * rules it will be held to.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/** Returns human-readable problems; empty array = acceptable. */
export function passwordProblems(
  password: string,
  context: { email?: string | null } = {}
): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Use at most ${PASSWORD_MAX_LENGTH} characters.`);
  }
  const email = context.email?.trim().toLowerCase();
  if (email && password.trim().toLowerCase() === email) {
    problems.push("Don't use your email address as your password.");
  }
  return problems;
}
