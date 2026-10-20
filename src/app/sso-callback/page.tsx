/**
 * /sso-callback — where Google sends the browser back after sign-in.
 * Public (allowlisted in src/proxy.ts): the session does not exist
 * until Clerk's client finishes the handshake here. Reads no data.
 */

import { SsoCallback } from "@/components/auth/sso-callback";
import { StaffClerkProvider } from "@/components/auth/staff-clerk-provider";
import { safeRedirectPath } from "@/lib/safe-redirect";

export default async function SsoCallbackPage({
  searchParams,
}: PageProps<"/sso-callback">) {
  const sp = await searchParams;
  const next = safeRedirectPath(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  return (
    <StaffClerkProvider>
      <div className="min-h-dvh flex items-center justify-center bg-paper-2 px-4">
        <p className="text-sm text-ink-3">Signing you in…</p>
      </div>
      <SsoCallback next={next} />
    </StaffClerkProvider>
  );
}
