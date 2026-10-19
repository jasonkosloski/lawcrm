/**
 * Client portal shell: firm name and logo, plus a sign-out control when a
 * session exists. NOT an auth gate (ADR-028): every page guards itself, and
 * Next does not re-run layouts on partial navigations.
 */

import type { Metadata } from "next";
import { getPortalIdentity } from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = {
  title: { absolute: "Client portal" },
  robots: { index: false, follow: false },
};

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [firm, identity] = await Promise.all([
    prisma.firm.findFirst({ select: { name: true, logoUrl: true } }),
    getPortalIdentity(),
  ]);

  return (
    <div className="min-h-dvh bg-paper-2 text-ink">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {firm?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={firm.logoUrl}
                alt=""
                className="size-8 shrink-0 rounded object-contain"
              />
            ) : null}
            <span className="truncate text-base font-semibold">
              {firm?.name ?? "Client portal"}
            </span>
          </div>
          {identity ? (
            <SignOutButton />
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
