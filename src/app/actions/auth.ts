/**
 * Auth server actions — login + logout.
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
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import {
  loginInitialState,
  type LoginFormState,
} from "@/lib/auth-form";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
  /** Where to land after a successful login. Defaults to the root.
   *  Validated as a relative path so it can't be used as an open
   *  redirect. */
  next: z.string().optional().default("/"),
});

/** Reject anything that isn't a same-origin relative path (open
 *  redirect prevention). External URLs, protocol-relative URLs, and
 *  empty strings all fall back to "/". */
function safeRedirectPath(raw: string | undefined | null): string {
  if (!raw) return "/";
  // Must start with a single "/" and not "//" (protocol-relative).
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

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
    // anything that isn't a CredentialsSignin so the redirect
    // bubbles to Next.
    if (err instanceof AuthError) {
      return { status: "error", error: "Invalid email or password." };
    }
    throw err;
  }

  // Unreachable — signIn either redirects or throws.
  return loginInitialState;
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
