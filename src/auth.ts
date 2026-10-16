/**
 * Auth.js (next-auth v5) configuration.
 *
 * Single source of truth for authentication. Re-exports the helpers
 * Next.js callers need (`auth`, `signIn`, `signOut`,
 * `unstable_update`, plus the route `handlers`) so app code never
 * imports from `next-auth` directly.
 *
 * Strategy:
 *   - Email + argon2id-hashed password via the Credentials provider
 *     (`authorizeCredentials` — no-enumeration + audit rules live
 *     there).
 *   - JWT sessions (no Session table). Revocation without a session
 *     row: the token carries a password fingerprint, so a password
 *     change/reset signs out every other session (ADR-017,
 *     `validateSessionToken`).
 *   - Prisma adapter wired up so adding Google OAuth (or any
 *     provider) later is a config-only change — Account +
 *     VerificationToken tables are already there.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { authorizeCredentials } from "@/lib/credentials-authorize";
import { validateSessionToken } from "@/lib/session-token";

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // JWT sessions — no DB Session row written. Swap to "database"
  // when we want true revocation; needs a Session model + a non-
  // credentials provider per Auth.js docs (credentials + DB sessions
  // is supported but has caveats).
  session: { strategy: "jwt" },
  // Custom pages keep us off the Auth.js default UI and inside the
  // app's layout. /login is built in app/login/page.tsx.
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      // No `name` shown in default UI — we render our own form.
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      // Body lives in src/lib/credentials-authorize.ts (tested there).
      authorize: authorizeCredentials,
    }),
    // Future providers — config-only when we wire them. Account
    // table is already in the schema, so no migration needed.
    //
    // Google({
    //   clientId: process.env.AUTH_GOOGLE_ID!,
    //   clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    //   // Optional: restrict to a Google Workspace domain.
    //   // authorization: { params: { hd: "kosloskilaw.com" } },
    // }),
  ],
  callbacks: {
    // Runs on sign-in (when `user` is present) AND on every
    // subsequent request that reads the JWT. Re-validates the user
    // (exists + active) and the password fingerprint (ADR-017) —
    // see src/lib/session-token.ts. An invalid token loses its
    // userId; the session callback then returns no user.id, and
    // `getCurrentUserId` bounces to /login.
    async jwt({ token, user, trigger }) {
      return validateSessionToken(token, {
        signInUserId: user?.id,
        trigger,
      });
    },
    // Expose the validated userId on session.user.id. When the JWT
    // has no userId (because validation in the jwt callback wiped
    // it), session.user.id stays undefined; downstream guards
    // (getCurrentUserId, dashboard layout) treat that as "logged
    // out" and bounce.
    async session({ session, token }) {
      if (token.userId && session.user) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
});
