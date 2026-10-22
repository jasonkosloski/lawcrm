/**
 * GET /api/integrations/google/callback
 *
 * Sanctioned route-handler exception (see ../connect/route.ts):
 * this is the EXTERNAL-CALLBACK endpoint Google redirects the
 * browser to — it cannot be a server action. Its URL must be
 * registered as an authorized redirect URI in the Google Cloud
 * console for every deploy origin (see .env.example).
 *
 * Flow: verify the CSRF state against the nonce cookie → exchange
 * the code at Google's token endpoint → userinfo for the mailbox
 * address → UPSERT the (session user, address) EmailAccount with
 * tokens (encrypted at rest by the ADR-011 Prisma extension) →
 * redirect to /settings/integrations?connected=1.
 *
 * Every failure redirects with a MACHINE CODE (?error=denied|state|
 * exchange|userinfo|scope|save|not_configured) that the page maps to readable
 * copy — token material and Google error bodies never reach URLs or
 * logs. The state cookie is cleared on every exit path.
 *
 * Multi-user & multi-account: keyed on @@unique([userId,
 * emailAddress]) — each firm member connects their own mailbox(es);
 * reconnecting an existing one refreshes tokens in place and keeps
 * the thread history (historyId survives disconnect/reconnect; a
 * stale cursor 404s into a full re-sync by design).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import {
  GOOGLE_CALLBACK_PATH,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_PATH,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  googleIntegrationConfigured,
  hasGmailScopes,
  resolveGoogleRedirectUri,
  verifyOAuthState,
} from "@/lib/google/oauth";
import { serializeAccessToken } from "@/lib/google/gmail-client";

export const dynamic = "force-dynamic";

/** Machine error codes the integrations page maps to readable copy. */
export type GoogleCallbackError =
  "denied" | "state" | "exchange" | "userinfo" | "scope" | "save" | "not_configured";

function redirectToSettings(
  origin: string,
  result: { connected: true } | { error: GoogleCallbackError },
): NextResponse {
  const url = new URL("/settings/integrations", origin);
  if ("connected" in result) url.searchParams.set("connected", "1");
  else url.searchParams.set("error", result.error);
  const response = NextResponse.redirect(url);
  // One-shot cookie — clear it on success AND failure so a retry
  // always starts from a fresh /connect.
  response.cookies.set(OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: OAUTH_STATE_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest): Promise<Response> {
  const origin = request.nextUrl.origin;

  const session = await getSession();
  if (!session?.user?.id) {
    // Session died mid-flow (expired while on Google's consent
    // screen). Send them to login; they restart from settings.
    return NextResponse.redirect(new URL("/login", origin));
  }
  const userId = session.user.id;

  if (!googleIntegrationConfigured()) {
    return redirectToSettings(origin, { error: "not_configured" });
  }

  const params = request.nextUrl.searchParams;

  // User clicked "Cancel" on the consent screen (error=access_denied)
  // or Google reported another authorization error.
  if (params.get("error")) {
    return redirectToSettings(origin, { error: "denied" });
  }

  // CSRF gate: the signed state must round-trip intact AND match
  // the nonce cookie set when THIS browser started the flow.
  const code = params.get("code");
  const cookieNonce = request.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null;
  if (!code || !verifyOAuthState(params.get("state"), cookieNonce)) {
    return redirectToSettings(origin, { error: "state" });
  }

  // Exchange the code. redirect_uri must EXACTLY match the connect
  // leg's — both derive from the same resolver, so it does.
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, resolveGoogleRedirectUri(request.nextUrl));
  } catch (err) {
    // Log the class of failure only — GoogleOAuthError messages are
    // token-free by construction, but stay conservative anyway.
    console.error(
      `[google-oauth] code exchange failed at ${GOOGLE_CALLBACK_PATH}:`,
      err instanceof Error ? err.message : "unknown error",
    );
    return redirectToSettings(origin, { error: "exchange" });
  }

  // Whose mailbox did we just get? (openid+email scope.)
  let email: string | null;
  try {
    ({ email } = await fetchGoogleUserInfo(tokens.access_token));
  } catch (err) {
    console.error(
      "[google-oauth] userinfo fetch failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return redirectToSettings(origin, { error: "userinfo" });
  }
  if (!email) {
    return redirectToSettings(origin, { error: "userinfo" });
  }

  // Granular consent: the user can untick the Gmail permissions on
  // Google's screen. Storing such a grant as "Connected" would fail
  // every sync with a bare 403 and no reconnect prompt, so refuse it
  // here — BEFORE the upsert, so an existing working row is not
  // overwritten. (`scope` absent = keep prior behavior; Google always
  // sends it on this grant.)
  if (tokens.scope && !hasGmailScopes(tokens.scope)) {
    return redirectToSettings(origin, { error: "scope" });
  }

  // With prompt=consent Google always sends a refresh_token; guard
  // anyway — an account row without one can't survive first expiry,
  // EXCEPT on reconnect where the stored one keeps working.
  const emailAddress = email.toLowerCase();
  const accessToken = serializeAccessToken(tokens.access_token, tokens.expires_in);

  // Tokens are encrypted at rest by the ADR-011 Prisma extension —
  // this top-level emailAccount.upsert is exactly the interception
  // point it covers.
  //
  // `grantedScopes` persists the token response's `scope` — the
  // scopes Google ACTUALLY granted (the user can untick boxes on
  // the consent screen, and pre-calendar connections never asked).
  // Written on connect AND reconnect so re-consenting an old
  // account lights up calendar sync (`hasCalendarScope` gates it).
  // Google always includes `scope` on the authorization_code grant;
  // if it were ever absent we keep the previous value rather than
  // clobbering a known grant with null.
  // The DB read + write are inside the machine-code contract too: a
  // transient DB error (or the encryption extension throwing on a
  // misconfigured key) must land on the settings banner, not a raw
  // 500 at the callback URL. Log the class only — never token
  // material.
  try {
    const existing = await prisma.emailAccount.findUnique({
      where: { userId_emailAddress: { userId, emailAddress } },
      select: { refreshToken: true },
    });
    if (!tokens.refresh_token && !existing?.refreshToken) {
      return redirectToSettings(origin, { error: "exchange" });
    }

    await prisma.emailAccount.upsert({
      where: { userId_emailAddress: { userId, emailAddress } },
      create: {
        userId,
        provider: "gmail",
        emailAddress,
        accessToken,
        refreshToken: tokens.refresh_token!,
        grantedScopes: tokens.scope ?? null,
        syncStatus: "connected",
      },
      update: {
        provider: "gmail",
        accessToken,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        ...(tokens.scope ? { grantedScopes: tokens.scope } : {}),
        syncStatus: "connected",
        syncError: null,
      },
    });
  } catch (err) {
    console.error(
      "[google-oauth] saving the connected account failed:",
      err instanceof Error ? err.name : "unknown error",
    );
    return redirectToSettings(origin, { error: "save" });
  }

  // Audit trail — a new mailbox gains read/modify/send access to the
  // user's Gmail. Address only; no token material.
  await logActivity({
    matterId: null,
    userId,
    type: "auth",
    title: `Connected Gmail account ${emailAddress}`,
  });

  return redirectToSettings(origin, { connected: true });
}
