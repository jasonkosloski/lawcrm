/**
 * Communication View Tabs
 *
 * Top-of-page segmented control on /communication. URL-driven via
 * `?view=email|messages|portal` so refresh and back-button work, and so a
 * deep-link pointing at a specific thread carries its view with it.
 *
 * Renders inside the TopBar's `below` slot so it scrolls with the
 * page header — matches the matters-list view-toggle pattern.
 */

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Mail, MessageSquare, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export type CommunicationView = "email" | "messages" | "portal";

export function CommunicationTabs({
  view,
  emailUnread,
  messengerUnread,
  showPortal = false,
}: {
  view: CommunicationView;
  emailUnread: number;
  messengerUnread: number;
  /** Viewer holds portal.view_messages: show the Client portal tab. */
  showPortal?: boolean;
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
    <div className="flex items-center gap-4 px-4 border-t border-line">
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
      {showPortal && (
        <Tab
          active={view === "portal"}
          href={buildHref("portal")}
          icon={<MessagesSquare size={13} />}
          label="Client portal"
          unread={0}
        />
      )}
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
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 h-9 -mb-px border-b-2 text-sm transition-colors",
        active ? "text-ink border-ink font-medium" : "text-ink-3 border-transparent hover:text-ink",
      )}
    >
      {icon}
      <span>{label}</span>
      {unread > 0 && (
        <span
          className={cn("text-2xs font-mono px-1.5 rounded-full", "bg-brand-50 text-brand-700")}
        >
          {unread}
        </span>
      )}
    </Link>
  );
}
