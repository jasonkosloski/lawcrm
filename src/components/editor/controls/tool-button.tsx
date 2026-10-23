/** The shared editor icon button (keeps editor focus on click) and toolbar divider. */

"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center rounded px-1 text-ink-3 hover:bg-paper-2 hover:text-ink disabled:pointer-events-none disabled:opacity-40",
        active && "bg-paper-2 text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function Divider() {
  return <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />;
}
