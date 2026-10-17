/**
 * argon2 hashing options shared by every place the app mints a password
 * hash (change-password, team invites/resets, the login timing
 * equaliser).
 *
 * Production (and dev) use the `argon2` library defaults for argon2id
 * (64 MiB, 3 passes, 4 lanes) — nothing here changes them. Under Vitest
 * (`NODE_ENV === "test"`, set by the runner; Next sets "production" /
 * "development") the cost is dropped to the algorithm's floor so the
 * ~100ms-per-hash real cost doesn't dominate the auth tests. The hash
 * string embeds its parameters, so `argon2.verify` of a test hash is
 * equally cheap and verification of production hashes is unaffected.
 *
 * Keyed on NODE_ENV rather than a dedicated flag so there is no env var
 * an operator could set to weaken production hashes by accident.
 */

import * as argon2 from "argon2";

export function argon2HashOptions(
  nodeEnv: string | undefined = process.env.NODE_ENV
): argon2.Options & { raw?: false } {
  if (nodeEnv === "test") {
    // Floors: memoryCost >= 8 * parallelism KiB, timeCost >= 1.
    return {
      type: argon2.argon2id,
      memoryCost: 1024,
      timeCost: 1,
      parallelism: 1,
    };
  }
  return { type: argon2.argon2id };
}
