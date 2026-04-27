/**
 * Conflict Check Card
 *
 * Replaces the static placeholder on the lead Overview tab with a
 * live conflict-check surface:
 *   - Current status (pending / clear / warn / conflict / override)
 *   - "Run check" button (when the user has the permission)
 *   - Live matches table (rendered server-side via the matcher,
 *     handed in as props so the lead page stays the single read
 *     source of truth)
 *   - Override workflow (textarea + button) when a warn/conflict
 *     is current and the user has the override permission
 *
 * The matcher is pure + read-only, so even non-permission users
 * see the matches if any exist — they just can't run / override.
 */

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  Hourglass,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  overrideLeadConflictCheck,
  runLeadConflictCheck,
} from "@/app/actions/conflict-check";
import type { ConflictMatch } from "@/lib/conflict-check";

type Status = "pending" | "clear" | "warn" | "conflict" | "override";

const STATUS_META: Record<
  Status,
  { label: string; tone: string; iconKey: string }
> = {
  pending: {
    label: "Not run yet",
    tone: "bg-paper-2 text-ink-3 border-line",
    iconKey: "hourglass",
  },
  clear: {
    label: "Clear",
    tone: "bg-ok-soft text-ok border-line",
    iconKey: "shield-check",
  },
  warn: {
    label: "Possible conflict",
    tone: "bg-warn-soft/60 text-warn border-warn-border",
    iconKey: "shield-alert",
  },
  conflict: {
    label: "Direct conflict",
    tone: "bg-warn-soft text-warn border-warn-border",
    iconKey: "shield-x",
  },
  override: {
    label: "Cleared (override)",
    tone: "bg-brand-soft text-brand-700 border-brand-200",
    iconKey: "shield-check",
  },
};

const formatRelative = (ts: Date | null): string => {
  if (!ts) return "never";
  const ms = Date.now() - new Date(ts).getTime();
  const min = Math.floor(ms / (60 * 1000));
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return `${Math.floor(day / 7)}w ago`;
};

export function ConflictCheckCard({
  leadId,
  status,
  checkedAt,
  resolutionNotes,
  matches,
  canRun,
  canOverride,
}: {
  leadId: string;
  status: Status;
  checkedAt: Date | null;
  resolutionNotes: string | null;
  matches: ConflictMatch[];
  canRun: boolean;
  canOverride: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideNotes, setOverrideNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const meta = STATUS_META[status] ?? STATUS_META.pending;
  const isFlagged = status === "warn" || status === "conflict";
  const showOverrideButton = canOverride && isFlagged;

  const handleRun = () => {
    setError(null);
    startTransition(async () => {
      const res = await runLeadConflictCheck(leadId);
      if (!res.ok) setError(res.error ?? "Couldn't run conflict check.");
    });
  };

  const handleOverride = () => {
    setError(null);
    if (overrideNotes.trim().length < 5) {
      setError("Justification must be at least 5 characters.");
      return;
    }
    const fd = new FormData();
    fd.set("notes", overrideNotes.trim());
    startTransition(async () => {
      const res = await overrideLeadConflictCheck(leadId, fd);
      if (!res.ok) {
        setError(res.error ?? "Couldn't override.");
      } else {
        setOverrideOpen(false);
        setOverrideNotes("");
      }
    });
  };

  const Icon = (() => {
    switch (meta.iconKey) {
      case "shield-check":
        return ShieldCheck;
      case "shield-alert":
        return ShieldAlert;
      case "shield-x":
        return ShieldX;
      default:
        return Hourglass;
    }
  })();

  return (
    <div className="flex flex-col gap-3">
      {/* Status header */}
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-2xs font-medium",
            meta.tone
          )}
        >
          <Icon size={12} />
          {meta.label}
        </div>
        <div className="text-2xs text-ink-4 font-mono">
          checked {formatRelative(checkedAt)}
        </div>
      </div>

      {/* Action row */}
      {(canRun || showOverrideButton) && (
        <div className="flex flex-wrap items-center gap-2">
          {canRun && (
            <Button
              type="button"
              variant="outline"
              onClick={handleRun}
              disabled={pending}
            >
              <RefreshCw size={12} className={pending ? "animate-spin" : ""} />
              {pending ? "Running…" : checkedAt ? "Re-run" : "Run conflict check"}
            </Button>
          )}
          {showOverrideButton && !overrideOpen && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOverrideOpen(true)}
            >
              Override…
            </Button>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      {/* Override composer */}
      {overrideOpen && showOverrideButton && (
        <div className="flex flex-col gap-2 p-3 rounded-md border border-warn-border bg-warn-soft/30">
          <div className="text-xs font-medium text-ink">
            Override conflict flag
          </div>
          <div className="text-2xs text-ink-3 leading-relaxed">
            Required for ethics-audit defensibility. Capture the
            justification — informed-consent waiver, former client
            with no substantial relationship, etc. Logged with your
            user id and timestamp.
          </div>
          <textarea
            value={overrideNotes}
            onChange={(e) => setOverrideNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Justification…"
            className="px-2.5 py-1.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4 resize-none"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOverrideOpen(false);
                setOverrideNotes("");
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleOverride}
              disabled={pending || overrideNotes.trim().length < 5}
            >
              {pending ? "Recording…" : "Override + clear"}
            </Button>
          </div>
        </div>
      )}

      {/* Saved override note (read-only) */}
      {status === "override" && resolutionNotes && (
        <div className="px-3 py-2 rounded-md border border-brand-200 bg-brand-soft/30 text-2xs text-ink-2">
          <div className="font-medium text-ink mb-0.5">Override rationale</div>
          {resolutionNotes}
        </div>
      )}

      {/* Matches list */}
      {matches.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Matches ({matches.length})
          </div>
          <ul className="border border-line rounded-md overflow-hidden divide-y divide-line">
            {matches.map((m, idx) => (
              <li
                key={`${m.kind}-${m.contactId ?? m.matterId ?? idx}`}
                className="flex items-start justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-block text-2xs font-medium px-1.5 py-0.5 rounded-full border",
                        m.severity === "conflict"
                          ? "bg-warn-soft text-warn border-warn-border"
                          : "bg-paper-2 text-ink-3 border-line"
                      )}
                    >
                      {m.severity === "conflict" ? "Conflict" : "Warn"}
                    </span>
                    <span className="text-2xs text-ink-4 font-mono">
                      via {m.matchedField}
                    </span>
                  </div>
                  <div className="text-xs text-ink mt-0.5 leading-snug">
                    {m.description}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0 text-2xs">
                  {m.contactId && (
                    <Link
                      href={`/contacts/${m.contactId}`}
                      className="text-brand-700 hover:underline"
                    >
                      Contact →
                    </Link>
                  )}
                  {m.matterId && (
                    <Link
                      href={`/matters/${m.matterId}`}
                      className="text-brand-700 hover:underline"
                    >
                      Matter →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        status !== "pending" && (
          <div className="text-2xs text-ink-4">
            {status === "clear"
              ? "No matches — name + email + org checked against active matters and contacts."
              : "No active matches; status reflects an earlier run or override."}
          </div>
        )
      )}
    </div>
  );
}
