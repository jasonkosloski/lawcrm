/**
 * Offset pagination for list pages.
 *
 * A list that can outgrow one screen reads `?page=N` from the URL
 * (ADR-007: the URL is the source of truth), counts its matches, and
 * fetches one page with `skip` / `take`. Out-of-range or junk page
 * values clamp into range instead of 404ing. The shared `<Pager>`
 * (src/components/shared/pager.tsx) renders the controls. See
 * docs/UI_PATTERNS.md → "Long lists: paginate, never truncate".
 */

import { firstParam } from "@/lib/search-params";

/** One page of a list plus what the pager needs to render. */
export type Page<T> = {
  rows: T[];
  /** 1-based, clamped into [1, pageCount]. */
  page: number;
  /** Always ≥ 1, even for an empty list. */
  pageCount: number;
  /** Rows matching the filter across all pages. */
  total: number;
  pageSize: number;
};

/** `?page=` → a positive integer (1 for missing / junk values). */
export function parsePageParam(raw: string | string[] | undefined): number {
  const n = Number(firstParam(raw));
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
}

/** Clamp `requested` against `total` and return the slice to fetch. */
export function pageWindow(
  total: number,
  requested: number,
  pageSize: number,
): { page: number; pageCount: number; skip: number; take: number } {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(
    Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : 1),
    pageCount,
  );
  return { page, pageCount, skip: (page - 1) * pageSize, take: pageSize };
}

/** Count, clamp, then fetch the page — the common shape of a paged
 *  Prisma read. `count` and `fetch` must use the same `where`. */
export async function paginate<T>(
  requested: number,
  pageSize: number,
  count: () => Promise<number>,
  fetch: (window: { skip: number; take: number }) => Promise<T[]>,
): Promise<Page<T>> {
  const total = await count();
  const w = pageWindow(total, requested, pageSize);
  const rows = total === 0 ? [] : await fetch({ skip: w.skip, take: w.take });
  return { rows, page: w.page, pageCount: w.pageCount, total, pageSize };
}

/** Slice an already-sorted in-memory list into a page (for lists that
 *  must be ordered in JS before paging, e.g. derived-field sorts). */
export function paginateArray<T>(all: readonly T[], requested: number, pageSize: number): Page<T> {
  const w = pageWindow(all.length, requested, pageSize);
  return {
    rows: all.slice(w.skip, w.skip + w.take),
    page: w.page,
    pageCount: w.pageCount,
    total: all.length,
    pageSize,
  };
}

/** 1-based inclusive row range shown on the page ("51–100 of 230"). */
export function pageRange(p: Pick<Page<unknown>, "page" | "pageSize" | "total">): {
  start: number;
  end: number;
} {
  if (p.total === 0) return { start: 0, end: 0 };
  return {
    start: (p.page - 1) * p.pageSize + 1,
    end: Math.min(p.total, p.page * p.pageSize),
  };
}

/** `href` with `?page=` set to `page` (removed for page 1, so the
 *  default stays out of the URL). Other params are preserved. */
export function withPageParam(href: string, page: number): string {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  if (page <= 1) params.delete("page");
  else params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** `path` plus the current `searchParams` record (repeated keys kept),
 *  minus `page` — the base href for a server page's `<Pager>`. */
export function hrefFromSearchParams(
  path: string,
  sp: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (key === "page" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
