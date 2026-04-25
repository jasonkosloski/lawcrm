/**
 * Auth.js module augmentation — adds the fields we put on the JWT
 * + session in `src/auth.ts` callbacks. Without this, TypeScript
 * sees `session.user.id` as `unknown` even though we set it.
 */

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** Undefined when the JWT references a user that no longer
       *  exists or is deactivated. The `jwt` callback in
       *  `src/auth.ts` strips it; downstream guards
       *  (getCurrentUserId, dashboard layout) treat that as
       *  "logged out" and bounce to /login. */
      id?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** Mirrors User.id; populated in the jwt callback on sign-in. */
    userId?: string;
  }
}
