import { headers } from "next/headers";

/**
 * True when `host` (a Host header, port allowed) is the client-portal
 * host: `PORTAL_HOST`, or `portal.localhost` outside production. Reads
 * the env per call so tests can stub it. A single trailing dot (FQDN
 * form) is ignored.
 */
export function isPortalHost(host: string | null): boolean {
  if (!host) return false;
  const norm = (h: string) =>
    h.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const name = norm(host);
  const configured = norm(process.env.PORTAL_HOST ?? "");
  if (configured && name === configured) return true;
  return name === "portal.localhost" && process.env.NODE_ENV !== "production";
}

/** Whether the current request arrived on the portal host. Outside a
 *  request scope (scripts) there is no host: not the portal. */
export async function requestIsOnPortalHost(): Promise<boolean> {
  try {
    return isPortalHost((await headers()).get("host"));
  } catch {
    return false;
  }
}
