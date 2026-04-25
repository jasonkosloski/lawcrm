/**
 * Auth.js (next-auth v5) configuration.
 *
 * Single source of truth for authentication. Re-exports the four
 * helpers Next.js callers need (`auth`, `signIn`, `signOut`, plus
 * the route `handlers`) so app code never imports from `next-auth`
 * directly.
 *
 * Strategy:
 *   - Email + argon2id-hashed password via the Credentials provider.
 *   - JWT sessions (no Session table) — keeps the surface small for
 *     v1; we swap to DB sessions when multi-user revoke-other-
 *     sessions UI lands.
 *   - Prisma adapter wired up so adding Google OAuth (or any
 *     provider) later is a config-only change — Account +
 *     VerificationToken tables are already there.
 *
 * Security notes:
 *   - `authorize` returns `null` for *every* failure mode (bad
 *     password, missing user, deactivated account). Never reveal
 *     which one — that prevents email enumeration.
 *   - Constant-time compare comes for free with argon2.verify.
 *   - `User.passwordHash === null` means "no credentials login" —
 *     reject without ever calling argon2.
 *   - `User.isActive === false` reject — keeps deactivated employees
 *     out without deleting their historical activity.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import * as argon2 from "argon2";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
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
      async authorize(raw) {
        // Validate shape first — Auth.js hands us `Partial<Record<...>>`
        // from the form, so we can't trust it.
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            passwordHash: true,
            isActive: true,
          },
        });
        // Same null return for every failure mode — never tell the
        // caller whether it was the email, the password, or the
        // active flag. Email enumeration prevention.
        if (!user || !user.passwordHash || !user.isActive) return null;

        const ok = await argon2.verify(user.passwordHash, parsed.data.password);
        if (!ok) return null;

        // The shape returned here lands in the `jwt` callback as the
        // `user` arg on first sign-in. We only forward what we want
        // on the session.
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
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
    // First sign-in: copy user.id onto the JWT. Subsequent calls
    // receive the existing token and we just pass it through.
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    // Expose the userId on session.user.id so server components +
    // actions can read it via `(await auth()).user.id`.
    async session({ session, token }) {
      if (token.userId && session.user) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
});
