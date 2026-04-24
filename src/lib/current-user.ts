/**
 * Current User
 *
 * Single resolver for "who is the current user" across all server queries
 * and actions. No auth yet — hardcoded to Jason by email. When login
 * lands, this becomes the session/cookie resolver and callers don't have
 * to change.
 */

import { prisma } from "@/lib/prisma";

const CURRENT_USER_EMAIL = "jkosloski@kosloskilaw.com";

export async function getCurrentUserId(): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email: CURRENT_USER_EMAIL },
    select: { id: true },
  });
  if (!user) {
    throw new Error(
      `Current user not found: no user with email ${CURRENT_USER_EMAIL}. Re-run the seed.`
    );
  }
  return user.id;
}

export async function getCurrentUser() {
  return prisma.user.findUnique({
    where: { email: CURRENT_USER_EMAIL },
    select: { id: true, name: true, initials: true, role: true },
  });
}
