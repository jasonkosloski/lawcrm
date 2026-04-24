/**
 * Event Link
 *
 * Client wrapper that turns any child content into a link to the
 * current page with `?event=<id>` added. Used by week view, month
 * view, and the agenda rail to open the event-detail modal when the
 * user clicks an event. Preserves all other query params (view, date)
 * so back-button behavior and refresh stay sane.
 */

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

export function EventLink({
  eventId,
  className,
  children,
}: {
  eventId: string;
  className?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  params.set("event", eventId);
  return (
    <Link
      href={`${pathname}?${params.toString()}`}
      scroll={false}
      className={className}
    >
      {children}
    </Link>
  );
}
