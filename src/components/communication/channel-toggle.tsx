/**
 * Communication Channel Toggle
 *
 * Segmented control for the matter/intake Communication tabs that
 * switches between the Email mini-inbox and the Phone log by writing
 * `?channel=...` to the URL (default channel `email` omits the
 * param). Plain links rather than router.replace — switching channel
 * also drops `?thread=`, which is per-channel state.
 *
 * Same visual idiom as MattersViewToggle.
 */

import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

const CHANNELS = [
  { value: "email", label: "Email", icon: Mail },
  { value: "phone", label: "Phone", icon: Phone },
] as const;

export type CommunicationChannel = (typeof CHANNELS)[number]["value"];

export function ChannelToggle({
  basePath,
  active,
}: {
  basePath: string;
  active: CommunicationChannel;
}) {
  return (
    <div
      role="group"
      aria-label="Communication channel"
      className="inline-flex items-center rounded-md border border-line bg-white p-0.5"
    >
      {CHANNELS.map((c) => {
        const isActive = active === c.value;
        const Icon = c.icon;
        return (
          <Link
            key={c.value}
            href={c.value === "email" ? basePath : `${basePath}?channel=${c.value}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 h-6 px-2 rounded text-2xs font-medium transition-colors",
              isActive
                ? "bg-brand-soft text-brand-700"
                : "text-ink-3 hover:text-brand-700"
            )}
          >
            <Icon size={12} />
            {c.label}
          </Link>
        );
      })}
    </div>
  );
}
