/**
 * Client portal shell: a letterhead-style navy header (firm name and logo,
 * plus the signed-in email and sign-out when a session exists) and a footer
 * with the firm's public contact details. NOT an auth gate (ADR-028): every
 * page guards itself, and Next does not re-run layouts on partial
 * navigations.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import { getPortalIdentity } from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = {
  title: { absolute: "Client portal" },
  robots: { index: false, follow: false },
};

// Every portal route reads the firm row (portal switch, letterhead) and the
// session, so nothing here may be prerendered at build time.
export const dynamic = "force-dynamic";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [firm, identity] = await Promise.all([
    prisma.firm.findFirst({
      select: {
        name: true,
        logoUrl: true,
        phone: true,
        email: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        zip: true,
      },
    }),
    getPortalIdentity(),
  ]);

  const firmName = firm?.name ?? "Client portal";
  const cityLine = [firm?.city, [firm?.state, firm?.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const address = [firm?.addressLine1, firm?.addressLine2, cityLine]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex min-h-dvh flex-col bg-paper-2 text-ink">
      <header className="bg-brand-900 text-white">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:py-5">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-white/40"
          >
            {firm?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={firm.logoUrl}
                alt=""
                className="size-9 shrink-0 rounded-md bg-white object-contain p-1"
              />
            ) : null}
            <span className="min-w-0">
              <span className="block truncate font-display text-lg leading-tight font-medium tracking-tight sm:text-xl">
                {firmName}
              </span>
              <span className="block text-xs text-brand-200">
                Client portal
              </span>
            </span>
          </Link>
          {identity ? (
            <div className="flex shrink-0 items-center gap-3">
              <span
                className="hidden max-w-56 truncate text-xs text-brand-200 sm:block"
                title={identity.email}
              >
                {identity.email}
              </span>
              <SignOutButton />
            </div>
          ) : null}
        </div>
        <div className="brand-gradient-line" aria-hidden="true" />
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-10">
        {children}
      </main>

      <footer className="border-t border-line bg-paper">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6 text-xs text-ink-3">
          <p className="font-medium text-ink-2">{firmName}</p>
          {firm?.phone || firm?.email || address ? (
            <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
              {firm?.phone ? (
                <li className="flex items-center gap-1.5">
                  <Phone className="size-3.5 text-ink-4" aria-hidden="true" />
                  <a
                    href={`tel:${firm.phone.replace(/[^\d+]/g, "")}`}
                    className="hover:text-ink hover:underline"
                  >
                    {firm.phone}
                  </a>
                </li>
              ) : null}
              {firm?.email ? (
                <li className="flex items-center gap-1.5">
                  <Mail className="size-3.5 text-ink-4" aria-hidden="true" />
                  <a
                    href={`mailto:${firm.email}`}
                    className="hover:text-ink hover:underline"
                  >
                    {firm.email}
                  </a>
                </li>
              ) : null}
              {address ? (
                <li className="flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-ink-4" aria-hidden="true" />
                  <span>{address}</span>
                </li>
              ) : null}
            </ul>
          ) : null}
          <p className="text-ink-4">
            Information in this portal is confidential and meant only for
            you. Please don&rsquo;t share your sign-in links.
          </p>
        </div>
      </footer>
    </div>
  );
}
