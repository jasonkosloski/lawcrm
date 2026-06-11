/**
 * Encryption-at-rest for OAuth tokens (AES-256-GCM).
 *
 * `EmailAccount.accessToken` / `refreshToken` must never hit the
 * database as plaintext — a leaked backup or a compromised DB read
 * replica would otherwise hand an attacker live Gmail credentials.
 * These helpers are the primitive; the enforcement point is the
 * Prisma client extension in `src/lib/email-token-encryption.ts`,
 * which encrypts on every `emailAccount` write and decrypts on
 * every read so feature code never handles ciphertext.
 *
 * Key management
 * --------------
 * The key comes from `EMAIL_TOKEN_KEY` — a base64-encoded 32-byte
 * secret (`openssl rand -base64 32`), set per environment and
 * never committed. Missing/malformed key fails loudly at the
 * first encrypt/decrypt, not silently with plaintext writes.
 *
 * Wire format (one opaque string, fits the existing TEXT column):
 *
 *   v1:<iv base64>:<auth tag base64>:<ciphertext base64>
 *
 * The `v1` prefix gives us a rotation/upgrade path: a future `v2`
 * (new key or algorithm) can coexist while old rows re-encrypt
 * lazily on read-then-write.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce size
const KEY_BYTES = 32;

/** Matches the v1 wire format — used to tell ciphertext from
 *  plaintext without attempting (and failing) a decrypt. */
const ENCRYPTED_RE = /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/;

function getKey(): Buffer {
  const raw = process.env.EMAIL_TOKEN_KEY;
  if (!raw) {
    throw new Error(
      "EMAIL_TOKEN_KEY is not set. Generate one with `openssl rand -base64 32` " +
        "and add it to your env (locally: .env, production: Vercel project " +
        "env vars). OAuth tokens cannot be stored without it."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `EMAIL_TOKEN_KEY must be ${KEY_BYTES} bytes of base64 ` +
        `(\`openssl rand -base64 32\`); got ${key.length} bytes after decoding.`
    );
  }
  return key;
}

/** True if `value` is already in the v1 encrypted wire format. */
export function isEncryptedToken(value: string): boolean {
  return ENCRYPTED_RE.test(value);
}

/** Encrypt a token for storage. Output is `v1:<iv>:<tag>:<ciphertext>`. */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Decrypt a stored token. Throws on tampering, a wrong key, or a
 *  malformed value — never returns garbage silently. */
export function decryptToken(stored: string): string {
  if (!isEncryptedToken(stored)) {
    throw new Error(
      "decryptToken: value is not in the v1 encrypted format. " +
        "Tokens must be written through the prisma emailAccount model " +
        "(or encryptToken) so they're encrypted before storage."
    );
  }
  const [, ivB64, tagB64, ciphertextB64] = stored.split(":");
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "decryptToken: authentication failed — the value was tampered with " +
        "or EMAIL_TOKEN_KEY differs from the key that encrypted it."
    );
  }
}
