/** Absolute sign-in link. Env is read per call. */
export function portalLinkUrl(raw: string): string {
  const host = process.env.PORTAL_HOST?.trim();
  const base = host
    ? `https://${host}`
    : "http://portal.localhost:3000";
  return `${base}/auth/verify?token=${encodeURIComponent(raw)}`;
}

/** Absolute portal home URL (no token). Env is read per call. */
export function portalHomeUrl(): string {
  const host = process.env.PORTAL_HOST?.trim();
  return host ? `https://${host}` : "http://portal.localhost:3000";
}
