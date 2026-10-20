"use server";

/**
 * DEV ONLY: mint a Clerk sign-in ticket for a seeded active user so
 * developers can test other roles locally without their Google
 * accounts. A deliberate backdoor — `isDevSignInAllowed()` is checked
 * FIRST, before any DB or Clerk access, and answers notFound() in
 * production, with a live Clerk key, or on Vercel. The page and the
 * proxy check it independently too.
 */

import { notFound } from "next/navigation";
import { logAuthEvent } from "@/lib/auth-events";
import { createDevSignInToken, ensureDevClerkUser } from "@/lib/clerk-admin";
import { isDevSignInAllowed } from "@/lib/dev-sign-in";
import { prisma } from "@/lib/prisma";

export type DevSignInResult =
  | { ok: true; ticket: string }
  | { ok: false; error: string };

export async function devSignInAs(userId: string): Promise<DevSignInResult> {
  if (!isDevSignInAllowed()) notFound();

  const user = await prisma.user.findFirst({
    where: { id: userId, isActive: true },
    select: { id: true, email: true, clerkUserId: true },
  });
  if (!user) return { ok: false, error: "No active user with that id." };

  let clerkUserId = user.clerkUserId;
  if (!clerkUserId) {
    const ensured = await ensureDevClerkUser(user.email);
    if (!ensured.ok) return ensured;
    clerkUserId = ensured.clerkUserId;
    // Conditional: never overwrite an id a concurrent sign-in just set.
    const { count } = await prisma.user.updateMany({
      where: { id: user.id, clerkUserId: null },
      data: { clerkUserId },
    });
    if (count === 0) {
      const fresh = await prisma.user.findUnique({
        where: { id: user.id },
        select: { clerkUserId: true },
      });
      if (!fresh?.clerkUserId) {
        return { ok: false, error: "Couldn't link the Clerk user." };
      }
      clerkUserId = fresh.clerkUserId;
    }
  }

  const token = await createDevSignInToken(clerkUserId);
  if (!token.ok) return token;

  await logAuthEvent({
    userId: user.id,
    kind: "dev_sign_in",
    reason: "dev sign-in-as",
  });
  return { ok: true, ticket: token.token };
}
