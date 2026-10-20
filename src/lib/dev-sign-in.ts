/**
 * The ONE switch for the dev-only "sign in as" backdoor
 * (/dev/sign-in-as). Pure and import-safe from the proxy. The page,
 * the `devSignInAs` action and the proxy each call it independently,
 * so any one of them alone keeps the backdoor shut in production.
 *
 * Allowed only when ALL hold: not NODE_ENV=production, a Clerk TEST
 * publishable key (`pk_test_`; a missing key counts as not allowed),
 * and not running on Vercel (previews build with NODE_ENV=production
 * anyway; VERCEL is belt and braces).
 */
export function isDevSignInAllowed(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    env.NODE_ENV !== "production" &&
    (env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "").startsWith("pk_test_") &&
    !env.VERCEL
  );
}
