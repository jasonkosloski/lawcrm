/**
 * Entity Source Chip
 *
 * Small "From note / From email / From message" chip rendered on
 * tasks, deadlines, and time entries that were spawned via the
 * inbox-to-action affordance or the in-note "+ Add" composers.
 *
 * Click navigates back to the source so the loop closes both ways.
 * Designed to sit inline with a row title — short, visually quiet,
 * doesn't dominate.
 */

import Link from "next/link";
import {
  Calendar,
  CircleAlert,
  Mail,
  Phone,
  StickyNote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { EntitySource } from "@/lib/queries/matter-detail";

export function EntitySourceChip({
  source,
  matterId,
  className,
}: {
  source: EntitySource;
  /** Required to build matter-scoped hrefs for note + email sources. */
  matterId: string;
  className?: string;
}) {
  const { Icon, prefix, href } = (() => {
    if (source.kind === "note") {
      return {
        Icon: StickyNote,
        prefix: "From note",
        href: `/matters/${matterId}/notes#note-${source.id}`,
      };
    }
    if (source.kind === "email") {
      return {
        Icon: Mail,
        prefix: "From email",
        href: `/matters/${matterId}/communication?thread=${source.id}`,
      };
    }
    if (source.kind === "event") {
      return {
        Icon: Calendar,
        prefix: "From event",
        href: `/matters/${matterId}/events?event=${source.id}`,
      };
    }
    if (source.kind === "deadline") {
      return {
        Icon: CircleAlert,
        prefix: "From deadline",
        href: `/matters/${matterId}/deadlines`,
      };
    }
    return {
      Icon: Phone,
      prefix: "From message",
      // Messenger view isn't matter-scoped yet — drop into the
      // firm-wide messenger inbox with the source thread selected.
      href: `/communication?view=messages&thread=${source.id}`,
    };
  })();

  return (
    <Link
      href={href}
      title={`${prefix}: ${source.label}`}
      className={cn(
        "inline-flex items-center gap-1 max-w-full text-2xs px-1.5 py-0.5 rounded border border-line bg-paper-2/60 text-ink-3",
        "hover:border-brand-300 hover:bg-brand-soft hover:text-brand-700 transition-colors",
        className
      )}
    >
      <Icon size={9} className="shrink-0 text-ink-4" />
      <span className="text-ink-4 shrink-0">{prefix}</span>
      <span className="truncate">{source.label}</span>
    </Link>
  );
}
