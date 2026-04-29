/**
 * "Back to list" button — mobile drill-down affordance for the
 * communication readers. Tapping strips `?thread=` from the URL,
 * which (per the responsive layout in ThreadList +
 * (Messenger)ThreadReader) re-shows the thread list on mobile.
 *
 * Hidden at lg+ where the list is always visible alongside the
 * reader. Renders nothing of value there.
 */

"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export function BackToListButton() {
  const pathname = usePathname();
  const sp = useSearchParams();

  const params = new URLSearchParams(sp.toString());
  params.delete("thread");
  const href = params.toString()
    ? `${pathname}?${params.toString()}`
    : pathname;

  return (
    <Link
      href={href}
      scroll={false}
      className="lg:hidden inline-flex items-center gap-1 text-2xs font-medium text-ink-3 hover:text-brand-700 -ml-1 mr-1 px-1 py-0.5 rounded"
      aria-label="Back to thread list"
    >
      <ArrowLeft size={14} />
      <span>Back</span>
    </Link>
  );
}
