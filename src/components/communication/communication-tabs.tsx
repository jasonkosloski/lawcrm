/**
 * Communication View Tabs
 *
 * Top-of-page segmented control on /communication. URL-driven via
 * `?view=email|messages` so refresh and back-button work, and so a
 * deep-link pointing at a specific thread carries its view with it.
 *
 * Renders inside the TopBar's `below` slot so it scrolls with the
 * page header — matches the matters-list view-toggle pattern.
 */

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Mail, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export type CommunicationView = "email" | "messages";

export function CommunicationTabs({
  view,
  emailUnread,
  messengerUnread,
}: {
  view: CommunicationView;
  emailUnread: number;
  messengerUnread: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Build the tab href while preserving any other query state — a
  // selected thread on one view should release when switching to the
  // other (different ID space), so we drop `thread` deliberately.
  const buildHref = (next: CommunicationView): string => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    params.delete("thread");
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div className="flex items-center gap-1 px-4 pt-2 pb-2 border-t border-line">
      <Tab
        active={view === "email"}
        href={buildHref("email")}
        icon={<Mail size={13} />}
        label="Email"
        unread={emailUnread}
      />
      <Tab
        active={view === "messages"}
        href={buildHref("messages")}
        icon={<MessageSquare size={13} />}
        label="Messages"
        unread={messengerUnread}
      />
    </div>
  );
}

function Tab({
  active,
  href,
  icon,
  label,
  unread,
}: {
  active: boolean;
  href: string;
  icon: React.ReactNode;
  label: string;
  unread: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors",
        active
          ? "bg-brand-500 text-white"
          : "text-ink-3 hover:bg-paper-2 hover:text-ink"
      )}
    >
      {icon}
      <span>{label}</span>
      {unread > 0 && (
        <span
          className={cn(
            "text-2xs font-mono px-1.5 rounded-full",
            active ? "bg-white/20 text-white" : "bg-brand-50 text-brand-700"
          )}
        >
          {unread}
        </span>
      )}
    </Link>
  );
}
