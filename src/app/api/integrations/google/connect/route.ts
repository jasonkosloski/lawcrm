/**
 * GET /api/integrations/google/connect
 *
 * Sanctioned route-handler exception (ARCHITECTURE.md: mutations are
 * server actions; route handlers only where the caller isn't our own
 * fetch — like the blob upload callback). OAuth is a BROWSER
 * REDIRECT dance with an external party: the user's browser must
 * top-level-navigate to Google and Google navigates back to a plain
 * GET URL, so neither leg can be a server action.
 *
 * This leg: session-gated; mints the CSRF state (nonce in a
 * short-lived httpOnly cookie + signed copy riding the `state`
 * param), builds the Google authorization URL (offline access,
 * forced consent so reconnects always yield a refresh_token), and
 * redirects. Per-user by design — whoever clicks Connect links
 * THEIR mailbox; the account row is keyed to the session user at
 * the callback.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_PATH,
  OAUTH_STATE_MAX_AGE_SECONDS,
  buildGoogleAuthUrl,
  createOAuthState,
  googleIntegrationConfigured,
  resolveGoogleRedirectUri,
} from "@/lib/google/oauth";

// A redirect with per-user cookies — never cache.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  }

  // Env not set on this deploy → bounce back with the banner the
  // integrations page maps to setup guidance (the UI hides the
  // button too; this covers a stale tab / hand-typed URL).
  if (!googleIntegrationConfigured()) {
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?error=not_configured",
        request.nextUrl.origin
      )
    );
  }

  const { state, nonce } = createOAuthState();
  const redirectUri = resolveGoogleRedirectUri(request.nextUrl);

  const response = NextResponse.redirect(
    buildGoogleAuthUrl({ redirectUri, state })
  );
  response.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    // lax: the callback arrives as a top-level cross-site GET
    // navigation from Google — strict would strip the cookie there.
    sameSite: "lax",
    secure: redirectUri.startsWith("https://"),
    path: OAUTH_STATE_COOKIE_PATH,
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });
  return response;
}
