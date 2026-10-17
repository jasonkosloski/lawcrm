/**
 * Per-request session reader.
 *
 * Every `auth()` call decrypts the JWE and runs the jwt callback
 * (`validateSessionToken` -> a `user.findUnique`), and Auth.js does no
 * per-request dedupe. A dashboard render used to pay that three times
 * (layout, `getCurrentUserId`, the timer query) on a 1-connection
 * pool. Everything that just needs "the session" calls this instead:
 * React `cache()` makes the first call do the work and the rest of the
 * same server render share the result.
 *
 * It calls the same `auth` export from `@/auth`, so tests that
 * `vi.mock("@/auth")` keep intercepting it. Outside a request render
 * (unit tests) `cache()` is a pass-through, so mocks that change
 * between calls behave as before.
 *
 * Caveat: after `unstable_update` in the same request the cached value
 * is stale. Only the user id is read from it by callers, and that never
 * changes, so this is acceptable.
 */

import { cache } from "react";
import { auth } from "@/auth";

export const getSession = cache(() => auth());
