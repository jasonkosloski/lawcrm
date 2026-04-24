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
  return (
    <a
      href={`mailto:${email}`}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => e.stopPropagation()}
      className={cn(
        "text-ink hover:text-brand-700 hover:underline transition-colors",
        className
      )}
    >
      {children ?? email}
    </a>
  );
}
