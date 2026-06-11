/**
 * Prisma client extension: transparent encryption-at-rest for
 * integration credentials —
 *
 *   - `EmailAccount.accessToken` / `refreshToken`
 *   - `MessengerAccount.accessToken` / `refreshToken` / `webhookSecret`
 *
 * Applied to the singleton in `src/lib/prisma.ts`, so every
 * `prisma.emailAccount.*` / `prisma.messengerAccount.*` call in the
 * app gets it for free:
 *
 *   - writes (`create` / `update` / `upsert` / `createMany` /
 *     `updateMany` / nested `{ set: ... }`) encrypt both token
 *     fields before they reach Postgres;
 *   - reads decrypt them on the way out, so feature code (the
 *     upcoming Gmail OAuth flow) only ever sees plaintext.
 *
 * Known boundary: only **top-level operations on these models** are
 * intercepted. A nested write through another model
 * (`prisma.user.update({ data: { emailAccounts: { create: ... } } })`)
 * or a nested read (`include: { emailAccounts: true }`) bypasses the
 * hook — writes would land plaintext, reads would surface ciphertext.
 * Always go through the model directly when credential fields are
 * involved. The reads direction fails safe (you see ciphertext, not
 * a leak); don't write tokens any other way.
 *
 * Crypto primitives + key management live in
 * `src/lib/email-token-crypto.ts`.
 */

import { Prisma } from "@/generated/prisma/client";
import {
  decryptToken,
  encryptToken,
  isEncryptedToken,
} from "@/lib/email-token-crypto";

const TOKEN_FIELDS = ["accessToken", "refreshToken"] as const;
const MESSENGER_FIELDS = [
  "accessToken",
  "refreshToken",
  "webhookSecret",
] as const;

type FieldList = readonly string[];

/** Encrypt a single write value: plain string or `{ set: string }`.
 *  Already-encrypted values pass through untouched so a read-modify-
 *  write of an unrelated field doesn't double-encrypt. */
function encryptWriteValue(value: unknown): unknown {
  if (typeof value === "string") {
    return isEncryptedToken(value) ? value : encryptToken(value);
  }
  if (value && typeof value === "object" && "set" in value) {
    const inner = (value as { set: unknown }).set;
    if (typeof inner === "string" && !isEncryptedToken(inner)) {
      return { ...value, set: encryptToken(inner) };
    }
  }
  return value;
}

/** Encrypt token fields in a `data` payload (object or array form). */
export function encryptTokenWrites<T>(data: T, fields: FieldList = TOKEN_FIELDS): T {
  if (Array.isArray(data)) {
    return data.map((row) => encryptTokenWrites(row, fields)) as T;
  }
  if (!data || typeof data !== "object") return data;
  const record = data as Record<string, unknown>;
  let out = record;
  for (const field of fields) {
    if (!(field in record)) continue;
    const encrypted = encryptWriteValue(record[field]);
    if (encrypted !== record[field]) {
      if (out === record) out = { ...record };
      out[field] = encrypted;
    }
  }
  return out as T;
}

/** Decrypt token fields in a query result (row, row[], or batch
 *  payloads like `{ count }`, which pass through untouched). */
export function decryptTokenReads<T>(result: T, fields: FieldList = TOKEN_FIELDS): T {
  if (Array.isArray(result)) {
    return result.map((row) => decryptTokenReads(row, fields)) as T;
  }
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  let out = record;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && isEncryptedToken(value)) {
      if (out === record) out = { ...record };
      out[field] = decryptToken(value);
    }
  }
  return out as T;
}

function makeOperationHook(fields: FieldList) {
  return async function $allOperations({
    args,
    query,
  }: {
    args: unknown;
    query: (args: unknown) => Promise<unknown>;
  }) {
    const payload = args as Record<string, unknown>;
    if (payload && typeof payload === "object") {
      // create/update/createMany/updateMany carry `data`;
      // upsert carries `create` + `update`.
      for (const key of ["data", "create", "update"] as const) {
        if (key in payload) {
          payload[key] = encryptTokenWrites(payload[key], fields);
        }
      }
    }
    const result = await query(args);
    return decryptTokenReads(result, fields);
  };
}

export const emailTokenEncryption = Prisma.defineExtension({
  name: "email-token-encryption",
  query: {
    emailAccount: {
      $allOperations: makeOperationHook(TOKEN_FIELDS),
    },
    messengerAccount: {
      $allOperations: makeOperationHook(MESSENGER_FIELDS),
    },
  },
});
