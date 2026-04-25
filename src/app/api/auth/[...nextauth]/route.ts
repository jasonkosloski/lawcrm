/**
 * Auth.js v5 catch-all route handler.
 *
 * Handles every `/api/auth/*` request — sign-in callbacks, CSRF
 * tokens, session reads, sign-out, OAuth callbacks (when wired).
 * The `handlers` object comes from `src/auth.ts` so all the config
 * lives in one place.
 */

import { handlers } from "@/auth";

export const { GET, POST } = handlers;
