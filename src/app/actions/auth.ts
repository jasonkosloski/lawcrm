/**
 * Auth server actions — login, logout, change password.
 *
 * Login wraps Auth.js's `signIn("credentials", …)` so we can:
 *   - validate the post body before handing to Auth.js
 *   - return a generic error to the client (no email enumeration)
 *   - control the post-login redirect via the `?next=` param
 *
 * The Credentials provider's `authorize()` in `src/auth.ts` returns
 * `null` for every failure mode; Auth.js then throws
 * `CredentialsSignin`, which we catch and convert to a form-state
 * error. Any other thrown error is re-raised so it surfaces in the
 * error overlay (or the prod error page).
 */

"use server";

import { AuthError } from "next-auth";
import * as argon2 from "argon2";
import { z } from "zod";
import { auth, signIn, signOut, unstable_update } from "@/auth";
import {
  loginInitialState,
  type LoginFormState,
} from "@/lib/auth-form";
import { logAuthEvent } from "@/lib/auth-events";
import { getCurrentUserId } from "@/lib/current-user";
import { reserveAttempt, settleAttempt } from "@/lib/credentials-authorize";
import { passwordProblems } from "@/lib/password-policy";
import { prisma } from "@/lib/prisma";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { passwordFingerprint } from "@/lib/session-fingerprint";
import type { ChangePasswordFormState } from "@/lib/security-form";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
  /** Where to land after a successful login. Defaults to the root.
   *  Sanitised with the shared `safeRedirectPath` (src/lib/safe-redirect.ts)
   *  so it can't be used as an open redirect. */
  next: z.string().optional().default("/"),
});

export async function loginAction(
  _prev: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    // Generic — never reveal which field failed; "Enter a valid
    // email" is fine because that's a syntactic check, not a
    // database one.
    return {
      status: "error",
      error:
        parsed.error.flatten().fieldErrors.email?.[0] ??
        parsed.error.flatten().fieldErrors.password?.[0] ??
        "Sign in failed.",
    };
  }

  const redirectTo = safeRedirectPath(parsed.data.next);

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo,
    });
  } catch (err) {
    // Auth.js uses thrown redirects internally — we MUST re-throw
    // anything that isn't an AuthError so the redirect bubbles to
    // Next.
    if (err instanceof AuthError) {
      if (err.type === "CredentialsSignin") {
        // Same text for every failure, lockout included — a distinct
        // "locked" message would confirm the account exists.
        return {
          status: "error",
          error:
            "Invalid email or password. After repeated failures, sign-in pauses for 15 minutes.",
        };
      }
      // Anything else (a DB outage inside authorize, a config
      // error…) is NOT a bad password — don't tell the user it is,
      // and don't hide it from the server logs.
      console.error("[auth] sign-in failed with a non-credentials error", err);
      return {
        status: "error",
        error: "Sign-in is temporarily unavailable. Please try again shortly.",
      };
    }
    throw err;
  }

  // Unreachable — signIn either redirects or throws.
  return loginInitialState;
}

export async function logoutAction(): Promise<void> {
  const session = await auth();
  if (session?.user?.id) {
    await logAuthEvent({ userId: session.user.id, kind: "sign_out" });
  }
  await signOut({ redirectTo: "/login" });
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z.string(),
  confirmPassword: z.string(),
});

/**
 * Change the signed-in user's own password. Identity-scoped (no
 * permission key — like profile edits, the target is always the
 * session user, never a form field).
 *
 * Requires the current password, holds the new one to
 * `passwordProblems`, and refuses a no-op change. On success the
 * password fingerprint in every OTHER session's JWT stops matching,
 * so they're signed out on their next request (ADR-017); this
 * session is re-stamped via `unstable_update({ pwv })` — the new
 * fingerprint travels in the payload and the jwt callback only
 * honours it when it matches the DB — and stays signed in.
 *
 * Wrong current-password guesses are throttled with the same
 * threshold/window as sign-in (`reserveAttempt`), so a hijacked
 * session can't brute-force the password through this action.
 */
export async function changePasswordAction(
  _prev: ChangePasswordFormState,
  formData: FormData
): Promise<ChangePasswordFormState> {
  const userId = await getCurrentUserId();
  const parsed = changePasswordSchema.safeParse(
    Object.fromEntries(formData.entries())
  );
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true },
  });
  if (!user) return { status: "error", errors: { _form: ["Account not found."] } };

  // Atomic check-and-record of the guess BEFORE verifying it.
  const attempt = await reserveAttempt({
    userId,
    lockKey: `password_change:${userId}`,
    failureKind: "password_change_failed",
    resetKinds: ["password_changed", "sign_in_unlocked"],
  });
  if (attempt.locked) {
    return {
      status: "error",
      errors: {
        currentPassword: [
          "Too many incorrect attempts. Try again in 15 minutes, or ask an administrator.",
        ],
      },
    };
  }

  const currentOk =
    !!user.passwordHash &&
    (await argon2.verify(user.passwordHash, currentPassword));
  if (!currentOk) {
    await settleAttempt(attempt.reservationId, {
      ok: false,
      reason: "wrong current password",
    });
    return {
      status: "error",
      errors: { currentPassword: ["Current password is incorrect."] },
    };
  }

  // Correct current password — the guess isn't a failure.
  await settleAttempt(attempt.reservationId, { ok: true });

  const problems = passwordProblems(newPassword, { email: user.email });
  if (problems.length > 0) {
    return { status: "error", errors: { newPassword: problems } };
  }
  if (newPassword !== confirmPassword) {
    return {
      status: "error",
      errors: { confirmPassword: ["Passwords don't match."] },
    };
  }
  // currentOk implies passwordHash is non-null.
  if (await argon2.verify(user.passwordHash!, newPassword)) {
    return {
      status: "error",
      errors: { newPassword: ["Choose a password you aren't using now."] },
    };
  }

  const passwordHash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
  });
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await logAuthEvent({ userId, kind: "password_changed" });

  // Re-stamp THIS session's fingerprint so it survives the change;
  // all other sessions fail the check on their next request. The
  // new fingerprint is the proof: the jwt callback only re-stamps
  // when it matches the DB (src/lib/session-token.ts), so a forged
  // POST /api/auth/session can't revive a stale token.
  await unstable_update({
    pwv: passwordFingerprint(passwordHash),
  } as unknown as Parameters<typeof unstable_update>[0]);

  return { status: "ok" };
}
