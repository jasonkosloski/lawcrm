/**
 * Pager — prev / next links plus "51–100 of 230 · page 2/5" for a
 * list paged by `?page=N` (src/lib/pagination.ts). Plain links, so it
 * works from server and client components alike and every page is a
 * shareable URL (ADR-007). Renders nothing when there's one page.
 */

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { pageRange, withPageParam, type Page } from "@/lib/pagination";

export function Pager({
  page,
  pageCount,
  total,
  pageSize,
  href,
  prevLabel = "Previous",
  nextLabel = "Next",
  className,
}: Pick<Page<unknown>, "page" | "pageCount" | "total" | "pageSize"> & {
  /** The current list URL with its filters (any `page` is replaced). */
  href: string;
  prevLabel?: string;
  nextLabel?: string;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  const { start, end } = pageRange({ page, pageSize, total });
  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex items-center justify-between gap-2 text-2xs font-mono text-ink-4",
        className,
      )}
    >
      <PagerLink href={withPageParam(href, page - 1)} disabled={page <= 1}>
        <ChevronLeft size={12} />
        {prevLabel}
      </PagerLink>
      <span>
        {start}–{end} of {total} · page {page}/{pageCount}
      </span>
      <PagerLink href={withPageParam(href, page + 1)} disabled={page >= pageCount}>
        {nextLabel}
        <ChevronRight size={12} />
      </PagerLink>
    </nav>
  );
}

function PagerLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const cls = cn(
    "inline-flex items-center gap-1 px-2 py-1 rounded-md border",
    disabled
      ? "border-line/60 text-ink-4/60 cursor-default"
      : "border-line-2 bg-white text-ink-3 hover:border-brand-300 hover:text-brand-700 transition-colors",
  );
  if (disabled) {
    return (
      <span className={cls} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** For a list that stays capped (paging it isn't worth it yet): says
 *  plainly that rows past the cap are hidden. Render only when the
 *  query reports it was truncated. */
export function TruncationNotice({
  shown,
  total,
  hint = "Refine your filter to narrow the list.",
  className,
}: {
  shown: number;
  /** Total matches when known; omit when only "more exist" is known. */
  total?: number;
  hint?: string;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={cn(
        "text-2xs font-mono text-ink-4 px-3 py-2 border border-dashed border-line rounded-md",
        className,
      )}
    >
      Showing the first {shown}
      {total !== undefined ? ` of ${total}` : ""}. {hint}
    </p>
  );
}
