/**
 * Google OAuth 2.0 plumbing for the per-user Gmail integration —
 * server-only (imports node:crypto + reads secrets; never ship to a
 * client bundle).
 *
 * Multi-user by design: ANY firm member connects THEIR OWN Gmail.
 * The only firm-level configuration is the OAuth app itself —
 * `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from env. Nothing
 * user-specific is hardcoded anywhere in this layer.
 *
 * Why plain `fetch` instead of `googleapis` / `google-auth-library`:
 * this flow touches exactly four Google endpoints (authorize, token,
 * userinfo, revoke), all simple form-POST/GET JSON. `googleapis` is
 * a ~100MB meta-package; `google-auth-library`'s OAuth2Client wants
 * to own token persistence/refresh itself, which fights our
 * encrypted-at-rest storage (ADR-011) and buys nothing we can't
 * express in ~40 lines of typed fetch. Zero new dependencies.
 *
 * CSRF (`state`) design — double-submit with a signature:
 *   - `createOAuthState()` mints a random nonce, HMAC-SHA256-signs
 *     it with `AUTH_SECRET`, and returns `state = nonce.signature`.
 *   - The bare nonce ALSO goes into a short-lived httpOnly cookie
 *     (set by the connect route).
 *   - `verifyOAuthState()` at the callback checks BOTH: the
 *     signature proves WE minted the state (it round-tripped
 *     through Google untampered), and the cookie match proves the
 *     flow started in THIS browser — a forged callback link can't
 *     bind an attacker's mailbox to a victim's session.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CALENDAR_EVENTS_SCOPE } from "@/lib/google/calendar-shared";

export const GOOGLE_AUTH_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_ENDPOINT =
  "https://openidconnect.googleapis.com/v1/userinfo";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** gmail.modify (read/label/archive for sync) + gmail.send, plus
 *  openid+email so the callback can learn WHICH address was
 *  connected without a second consent, plus calendar.events for
 *  two-way calendar sync (events only — deliberately NOT the
 *  full `calendar` scope, and NOT the full-power
 *  `https://mail.google.com/` scope). Accounts connected before
 *  the calendar scope joined this list lack it in
 *  `EmailAccount.grantedScopes`; features gate on
 *  `hasCalendarScope` and prompt to reconnect. */
export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  CALENDAR_EVENTS_SCOPE,
] as const;

/** Nonce cookie for the state double-submit. Path-scoped to the
 *  google integration routes — no other request needs to carry it. */
export const OAUTH_STATE_COOKIE = "google_oauth_state";
export const OAUTH_STATE_COOKIE_PATH = "/api/integrations/google";
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;

export const GOOGLE_CALLBACK_PATH = "/api/integrations/google/callback";

/** True when the Google OAuth app is configured for this deploy.
 *  The UI uses this to render "not configured" guidance instead of
 *  a connect button that would 500. */
export function googleIntegrationConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
}

function requireEnv(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "AUTH_SECRET"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set — the Google integration requires it. ` +
        "See .env.example for setup instructions."
    );
  }
  return value;
}

// ── State (CSRF) ─────────────────────────────────────────────────────────

function signNonce(nonce: string): string {
  return createHmac("sha256", requireEnv("AUTH_SECRET"))
    .update(`google-oauth-state:${nonce}`)
    .digest("base64url");
}

/** Mint a state for a new authorization redirect. `state` goes to
 *  Google (round-trips to the callback); `nonce` goes into the
 *  httpOnly cookie. */
export function createOAuthState(): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("hex");
  return { state: `${nonce}.${signNonce(nonce)}`, nonce };
}

/** Verify a callback's `state` against the browser's nonce cookie.
 *  Constant-time on the signature; false on ANY malformation —
 *  never throws on attacker-controlled input. */
export function verifyOAuthState(
  state: string | null | undefined,
  cookieNonce: string | null | undefined
): boolean {
  if (!state || !cookieNonce) return false;
  const dot = state.indexOf(".");
  if (dot <= 0) return false;
  const nonce = state.slice(0, dot);
  const signature = state.slice(dot + 1);
  const expected = signNonce(nonce);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return nonce === cookieNonce;
}

// ── Redirect URI ─────────────────────────────────────────────────────────

/**
 * Callback URL for this deploy — NEVER hardcoded. Prefers
 * `AUTH_URL` (matching Auth.js's convention for
 * behind-a-proxy/CDN deploys where the request host is internal);
 * otherwise derives from the incoming request's origin. Both the
 * localhost and production values must be registered as authorized
 * redirect URIs in the Google Cloud console (see .env.example).
 */
export function resolveGoogleRedirectUri(requestUrl: string | URL): string {
  const authUrl = process.env.AUTH_URL;
  const origin = authUrl
    ? new URL(authUrl).origin
    : new URL(requestUrl).origin;
  return `${origin}${GOOGLE_CALLBACK_PATH}`;
}

// ── Authorization URL ────────────────────────────────────────────────────

export function buildGoogleAuthUrl(opts: {
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", requireEnv("GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  // offline + consent → Google issues a refresh_token EVERY time,
  // including reconnects of a previously-authorized account (without
  // `prompt=consent`, re-auth returns no refresh_token and the
  // account would die at first expiry).
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  // Keep previously-granted scopes when we add more later (e.g.
  // Calendar) instead of resetting the grant.
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", opts.state);
  return url.toString();
}

// ── Token endpoint calls ─────────────────────────────────────────────────

/** Google token-endpoint success shape (both grant types). */
export interface GoogleTokenResponse {
  access_token: string;
  /** Lifetime in seconds (Google: typically 3599). */
  expires_in: number;
  /** Present on the authorization_code grant with prompt=consent;
   *  usually ABSENT on refresh (Google rotates rarely). */
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

/** A failed Google OAuth call. `code` is Google's machine error
 *  ("invalid_grant", "access_denied", …). The message NEVER
 *  contains token material — safe to log and to surface. */
export class GoogleOAuthError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
    readonly status: number | null = null
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

async function tokenEndpointCall(
  params: Record<string, string>
): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      ...params,
    }),
  });
  if (!response.ok) {
    // Error body: { error: "invalid_grant", error_description: "..." }.
    // Parse defensively — never let a weird body mask the failure.
    let code: string | null = null;
    try {
      const body = (await response.json()) as { error?: string };
      if (typeof body.error === "string") code = body.error;
    } catch {
      // Non-JSON error body; status alone will have to do.
    }
    throw new GoogleOAuthError(
      `Google token endpoint returned ${response.status}` +
        (code ? ` (${code})` : ""),
      code,
      response.status
    );
  }
  const body = (await response.json()) as GoogleTokenResponse;
  if (!body.access_token || typeof body.expires_in !== "number") {
    throw new GoogleOAuthError(
      "Google token endpoint returned an unexpected payload shape."
    );
  }
  return body;
}

/** Exchange an authorization code (from the callback) for tokens. */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<GoogleTokenResponse> {
  return tokenEndpointCall({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

/** Refresh an expired access token. Throws GoogleOAuthError with
 *  code "invalid_grant" when the user revoked access — the caller
 *  (gmail-client) marks the account for reconnect. */
export async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<GoogleTokenResponse> {
  return tokenEndpointCall({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

/** The connected account's email address via the OIDC userinfo
 *  endpoint (covered by the openid+email scopes). */
export async function fetchGoogleUserInfo(
  accessToken: string
): Promise<{ email: string | null }> {
  const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new GoogleOAuthError(
      `Google userinfo endpoint returned ${response.status}`,
      null,
      response.status
    );
  }
  const body = (await response.json()) as { email?: string };
  return { email: typeof body.email === "string" ? body.email : null };
}

/** Best-effort revocation at disconnect. Revoking EITHER token of a
 *  grant kills the whole grant. Returns false instead of throwing —
 *  a Google outage must never block a local disconnect. */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
