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
  const Icon = empty?.icon;
  return (
    <section
      data-slot="dashboard-card"
      className="@container flex flex-col rounded-xl border border-line bg-card px-4 py-3"
    >
      <header className="mb-2 flex items-center gap-2">
        <h2 className="font-display text-base text-ink">{title}</h2>
        {count !== undefined && (
          <span className="font-mono text-2xs text-ink-3">{count}</span>
        )}
        {warn && (
          <LatePill tone="warn">{warn}</LatePill>
        )}
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
      {empty && Icon ? (
        <div className="flex items-center gap-2 py-3 text-xs text-ink-4">
          <Icon className="size-4 text-ink-4" aria-hidden />
          <span>{empty.text}</span>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

const ROW_CLASS =
  "flex items-center gap-3 py-2 border-b border-line last:border-b-0";

export function DashboardRow({
  href,
  children,
}: {
  href?: string;
  children: ReactNode;
}) {
  if (href) {
    return (
      <Link href={href} className={cn(ROW_CLASS, "hover:bg-paper-2")}>
        {children}
      </Link>
    );
  }
  return <div className={ROW_CLASS}>{children}</div>;
}

const TONES = {
  warn: "bg-warn-soft text-warn border-warn-border",
  brand: "bg-brand-soft text-brand-700 border-brand-200",
  muted: "bg-paper-2 text-ink-3 border-line",
} as const;

export function LatePill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: keyof typeof TONES;
}) {
  return (
    <span
      className={cn(
        "text-2xs font-mono font-medium px-2 py-0.5 rounded-full border",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
