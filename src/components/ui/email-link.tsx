/**
 * Email Link — renders an email address as a `mailto:` anchor. Used
 * everywhere an email appears so the app has a single place to
 * tweak hover/focus styles and keep the behavior consistent.
 *
 * The anchor stops click propagation so tapping an email inside a
 * larger clickable row (e.g. an event row that also opens a modal)
 * doesn't swallow the mailto. The span still inherits layout styles
 * from whichever parent cell it's in via `className`.
 */

"use client";

import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One bare address: a local part and a domain, no whitespace, no
 *  second `@`, and none of the characters that separate recipients or
 *  open a display-name / quoted form (`, ; < > " \`). Deliberately
 *  loose beyond that - stored values are free text and we only need to
 *  guarantee the value is ONE recipient before it goes in a URL. */
const SINGLE_ADDRESS = /^[^\s@,;<>"\\]+@[^\s@,;<>"\\]+$/;

/**
 * Build a `mailto:` href from a stored (free-text, staff-typed) email,
 * or null when the value isn't a single plausible address. The address
 * is percent-encoded so `?`, `&`, `#`, `%` can never become a mailto
 * header (`?bcc=...`), a fragment or an escape: a contact saved as
 * "client@x.com?bcc=other@y.com" must not silently Bcc someone on every
 * email staff start from the link. `@` and `+` stay literal (RFC 6068
 * permits both in the address and clients expect them).
 */
export function mailtoHref(email: string | null | undefined): string | null {
  const trimmed = email?.trim();
  if (!trimmed || !SINGLE_ADDRESS.test(trimmed)) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  const encoded = encodeURIComponent(trimmed).replace(/%40/gi, "@").replace(/%2B/gi, "+");
  return `mailto:${encoded}`;
}

export function EmailLink({
  email,
  className,
  children,
}: {
  email: string | null | undefined;
  className?: string;
  /** Optional override for the visible text (e.g. when the display
   *  format is "Name <email>" but the href is just the email). */
  children?: ReactNode;
}) {
  if (!email) return null;
  const href = mailtoHref(email);
  // Not a single address (typo, several addresses, injected `?bcc=`):
  // show the text, but never make it a link that could mail someone
  // other than the person on screen.
  if (!href) return <span className={className}>{children ?? email}</span>;
  return (
    <a
      href={href}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => e.stopPropagation()}
      className={cn("text-ink hover:text-brand-700 hover:underline transition-colors", className)}
    >
      {children ?? email}
    </a>
  );
}
