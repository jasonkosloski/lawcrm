import { headers } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { CSP_HEADER, nonceFromCsp } from "@/lib/csp";

/**
 * Clerk's provider for STAFF surfaces only (the dashboard, print and
 * auth pages). Deliberately not in the root layout: portal pages must
 * never load Clerk.
 *
 * `dynamic` makes auth data available to client components and is
 * required for the CSP nonce, which is read from the same request
 * header Next stamps its own scripts from (set in src/proxy.ts).
 */
export async function StaffClerkProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = nonceFromCsp((await headers()).get(CSP_HEADER));
  return (
    <ClerkProvider dynamic nonce={nonce} signInUrl="/login">
      {children}
    </ClerkProvider>
  );
}
