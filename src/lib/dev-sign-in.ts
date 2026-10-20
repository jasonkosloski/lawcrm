import { checkDestructiveDbAllowed } from "@/lib/seed-guard";

/**
 * The ONE switch for the dev-only "sign in as" backdoor
 * (/dev/sign-in-as). Pure and import-safe from the proxy. The page,
 * the `devSignInAs` action and the proxy each call it independently,
 * so any one of them alone keeps the backdoor shut in production.
 *
 * Allowed only when ALL hold: the explicit opt-in `DEV_SIGN_IN=1`,
 * not NODE_ENV=production, a Clerk TEST publishable key (`pk_test_`;
 * a missing key counts as not allowed), not running on Vercel
 * (previews build with NODE_ENV=production anyway; VERCEL is belt and
 * braces), and a database the destructive-tooling guard accepts
 * (localhost, or a known dev DB via ALLOW_SEED=1), so a dev server
 * pointed at real data can never offer the backdoor.
 */
export function isDevSignInAllowed(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    env.DEV_SIGN_IN === "1" &&
    env.NODE_ENV !== "production" &&
    (env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "").startsWith("pk_test_") &&
    !env.VERCEL &&
    checkDestructiveDbAllowed(env).ok
  );
}
