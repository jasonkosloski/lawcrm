import { createHash, randomBytes } from "node:crypto";

/** A new unguessable secret: 32 random bytes, base64url. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex of a secret. Only this form is ever stored. */
export function hashSecret(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
