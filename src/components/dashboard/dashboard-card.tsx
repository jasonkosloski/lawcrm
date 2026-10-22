import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function DashboardCard({
  title,
  count,
  warn,
  viewAllHref,
  empty,
  children,
}: {
  title: string;
  count?: number;
  warn?: string;
  viewAllHref?: string;
  empty?: { icon: LucideIcon; text: string } | null;
  children?: ReactNode;
}) {
  return (
    <section
      data-slot="dashboard-card"
      className="@container flex flex-col rounded-xl border border-line bg-card px-4 py-3"
    >
      <header className="mb-1 flex items-center gap-2">
        <h2 className="text-[15px] leading-snug font-semibold text-ink">{title}</h2>
        {count !== undefined && (
          <span className="text-xs font-normal text-ink-4 tabular-nums">{count}</span>
        )}
        {warn && <LatePill tone="danger">{warn}</LatePill>}
        {viewAllHref && (
          <Link
            href={viewAllHref}
            aria-label={`View all ${title}`}
            className="ml-auto text-2xs text-ink-3 hover:text-ink"
          >
            View all
          </Link>
        )}
      </header>
      {empty ? (
        <div className="flex items-center gap-2 py-3 text-xs text-ink-4">
          <empty.icon className="size-4 text-ink-4" aria-hidden />
          <span>{empty.text}</span>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

const ROW_CLASS = "flex items-center gap-3 py-2 border-b border-line-2 last:border-b-0";

export function DashboardRow({ href, children }: { href?: string; children: ReactNode }) {
  if (href) {
    return (
      <Link
        href={href}
        className={cn(ROW_CLASS, "-mx-2 rounded-md px-2 transition-colors hover:bg-paper")}
      >
        {children}
      </Link>
    );
  }
  return <div className={ROW_CLASS}>{children}</div>;
}

const TONES = {
  danger: "bg-danger-soft text-danger",
  muted: "bg-paper-2 text-ink-3",
} as const;

export function LatePill({ children, tone }: { children: ReactNode; tone: keyof typeof TONES }) {
  return (
    <span className={cn("text-2xs font-medium px-2 py-0.5 rounded-full", TONES[tone])}>
      {children}
    </span>
  );
}
