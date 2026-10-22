import { createHash, createHmac, randomBytes } from "node:crypto";

/** A new unguessable secret: 32 random bytes, base64url. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256 hex of a high-entropy secret (tokens, session cookies). Only this
 * form is ever stored. Not for low-entropy values; use hmacSecret.
 */
export function hashSecret(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Dev/test-only key; never used in production. */
const DEV_HMAC_KEY = "lawcrm-dev-portal-hmac-key";
let warnedNoKey = false;

/**
 * HMAC-SHA256 hex keyed with AUTH_SECRET, for low-entropy values (emails,
 * IPs) where a plain hash could be reversed by guessing. Without
 * AUTH_SECRET: a fixed dev key outside production; in production, plain
 * SHA-256 with a one-time error log (the app cannot sign in staff without
 * AUTH_SECRET anyway, so this is a misconfiguration, not a mode).
 */
export function hmacSecret(s: string): string {
  const key = process.env.AUTH_SECRET;
  if (key) return createHmac("sha256", key).update(s).digest("hex");
  if (process.env.NODE_ENV !== "production") {
    return createHmac("sha256", DEV_HMAC_KEY).update(s).digest("hex");
  }
  if (!warnedNoKey) {
    warnedNoKey = true;
    console.error(
      "[portal] AUTH_SECRET is not set; link-request hashes fall back to unkeyed SHA-256",
    );
  }
  return hashSecret(s);
}

export function __resetHmacWarningForTests(): void {
  warnedNoKey = false;
}
