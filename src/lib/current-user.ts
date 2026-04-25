/**
 * Current User
 *
 * Single resolver for "who is the current user" across all server
 * queries and actions. Reads from the Auth.js session — every caller
 * stays the same since the function signature is unchanged.
 *
 * Behavior:
 *   - Logged in → returns the session user id.
 *   - Not logged in → throws a Next.js redirect to `/login`. Pages
 *     and server actions that call this never have to think about
 *     the unauth case; the proxy + this throw cover it twice.
 *
 * Multi-tenant note: when `firmId` lands on the session, expose it
 * here too (e.g. `getCurrentUserContext(): { userId, firmId }`).
 * Existing callers that just need the user id keep using this fn.
 */

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function getCurrentUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    // Anything past this point would dereference a missing user, so
    // bounce to login. This throws — no return value.
    redirect("/login");
  }
  return session.user.id;
}

/** Read the current user's display fields for the sidebar / topbar.
 *  Returns null if not signed in (the layout is rendered for the
 *  login page too, so the null branch matters). */
export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, initials: true, jobTitle: true },
  });
}
