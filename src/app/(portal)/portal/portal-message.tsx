/** Full-page message (404, error) in the portal's voice. Server-safe. */

import type { LucideIcon } from "lucide-react";

export function PortalMessage({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-600">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-medium tracking-tight text-brand-900">
          {title}
        </h1>
        <p className="text-sm leading-relaxed text-ink-3">{description}</p>
      </div>
      {children ? (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}
