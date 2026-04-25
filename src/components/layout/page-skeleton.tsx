/**
 * Page Skeleton
 *
 * Generic loading placeholder for any dashboard route. Mirrors the
 * standard page shape — topbar + body — so the layout doesn't jump
 * when the real page renders. Used by `loading.tsx` files in the
 * highest-traffic route segments.
 *
 * `variant` controls the body shape so a list page feels different
 * from a detail page during the brief load:
 *   - "tiles" → grid of KPI/summary cards (good for dashboards)
 *   - "table" → header bar + rows (matters list, intake list, time)
 *   - "detail" → header card + content card (matter detail, lead detail)
 *   - "grid"   → calendar-week-style 7-column grid
 */

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function PageSkeleton({
  variant = "detail",
}: {
  variant?: "tiles" | "table" | "detail" | "grid";
}) {
  return (
    <>
      {/* TopBar skeleton */}
      <div className="flex flex-col shrink-0 bg-card border-b border-line">
        <div className="brand-gradient-line" />
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-6 w-44" />
          </div>
          <Skeleton className="h-7 w-28" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {variant === "tiles" && <TilesBody />}
        {variant === "table" && <TableBody />}
        {variant === "detail" && <DetailBody />}
        {variant === "grid" && <GridBody />}
      </div>
    </>
  );
}

function TilesBody() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-3">
            <Skeleton className="h-3 w-20 mb-2" />
            <Skeleton className="h-7 w-16 mb-1" />
            <Skeleton className="h-2.5 w-24" />
          </Card>
        ))}
      </div>
      <div className="flex gap-5">
        <div className="flex-1 flex flex-col gap-5">
          <CardBlock lines={4} />
          <CardBlock lines={5} />
        </div>
        <div className="w-85 flex flex-col gap-5">
          <CardBlock lines={6} />
          <CardBlock lines={3} />
        </div>
      </div>
    </div>
  );
}

function TableBody() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line bg-paper-2/40">
          <Skeleton className="h-3 w-full max-w-3xl" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3 border-b border-line last:border-b-0"
          >
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-1/6" />
            <Skeleton className="h-3 w-1/5 ml-auto" />
            <Skeleton className="h-3 w-1/6" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </Card>
    </div>
  );
}

function DetailBody() {
  return (
    <div className="flex flex-col gap-5 max-w-5xl">
      <CardBlock lines={3} />
      <CardBlock lines={6} />
      <CardBlock lines={4} />
    </div>
  );
}

function GridBody() {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="px-3 py-2 border-l border-line first:border-l-0">
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 min-h-[60vh]">
        {Array.from({ length: 7 }).map((_, col) => (
          <div
            key={col}
            className="border-l border-line first:border-l-0 p-2 flex flex-col gap-2"
          >
            {Array.from({ length: 3 }).map((_, row) => (
              <Skeleton key={row} className="h-10 w-full" />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function CardBlock({ lines }: { lines: number }) {
  return (
    <Card className="p-4">
      <Skeleton className="h-4 w-32 mb-3" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={`h-3 ${i % 3 === 0 ? "w-3/4" : i % 3 === 1 ? "w-full" : "w-2/3"}`} />
        ))}
      </div>
    </Card>
  );
}
