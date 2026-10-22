const PRODUCTION = process.env.NODE_ENV === "production";

/** `__Host-` requires Secure, Path=/ and no Domain; dev runs over plain http. */
export const PORTAL_COOKIE = PRODUCTION ? "__Host-portal_session" : "portal_session";

export function portalCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
} {
  return { httpOnly: true, secure: PRODUCTION, sameSite: "lax", path: "/" };
}
