/**
 * Pure helpers for scripts/clerk-preflight.ts (read-only production
 * cutover check). Kept apart so they are unit-testable without a DB.
 */

export const FIRM_EMAIL_DOMAIN = "@kosloskilaw.com";

/** Host (with port) and the first 6 chars of the URL user. NEVER the
 *  password. Unparseable input yields a placeholder, not an error. */
export function describeDatabaseUrl(url: string | undefined): {
  host: string;
  userPrefix: string;
} {
  if (!url) return { host: "(DATABASE_URL not set)", userPrefix: "" };
  try {
    const u = new URL(url);
    return {
      host: u.host,
      userPrefix: decodeURIComponent(u.username).slice(0, 6),
    };
  } catch {
    return { host: "(unparseable DATABASE_URL)", userPrefix: "" };
  }
}

export type PreflightUser = {
  email: string;
  name: string;
  clerkUserId: string | null;
};

/** Active users whose email is outside the firm's Google domain (they
 *  cannot sign in with a firm Google account), plus the linked count. */
export function summarizePreflight(users: PreflightUser[]): {
  outsideFirmDomain: PreflightUser[];
  linked: number;
  total: number;
} {
  return {
    outsideFirmDomain: users.filter((u) => !u.email.toLowerCase().endsWith(FIRM_EMAIL_DOMAIN)),
    linked: users.filter((u) => u.clerkUserId !== null).length,
    total: users.length,
  };
}

export function formatPreflight(
  db: { host: string; userPrefix: string },
  s: ReturnType<typeof summarizePreflight>,
): string {
  const lines = [
    `Connected to ${db.host}` + (db.userPrefix ? ` as user "${db.userPrefix}..."` : ""),
    `Active users: ${s.total}; already linked to Clerk: ${s.linked}`,
  ];
  if (s.outsideFirmDomain.length === 0) {
    lines.push(`Every active user has a ${FIRM_EMAIL_DOMAIN} email.`);
  } else {
    lines.push(
      `Active users NOT on ${FIRM_EMAIL_DOMAIN} (${s.outsideFirmDomain.length}) - need a manual plan before cutover:`,
      ...s.outsideFirmDomain.map((u) => `  - ${u.name} <${u.email}>`),
    );
  }
  return lines.join("\n");
}
