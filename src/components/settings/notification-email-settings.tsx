/**
 * Notification email settings — one Off / Instant / Daily digest
 * radiogroup per category (Deadlines has no Off), plus the list of
 * matters the user muted. Saves optimistically; a refused or failed
 * save reverts and reports.
 */

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  setMatterEmailMute,
  setNotificationEmailMode,
} from "@/app/actions/notification-preferences";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { notifyError } from "@/lib/feedback";
import {
  NOTIFICATION_CATEGORIES,
  type EmailMode,
  type NotificationCategory,
} from "@/lib/notification-categories";
import { cn } from "@/lib/utils";

const MODE_LABEL: Record<EmailMode, string> = {
  off: "Off",
  instant: "Instant",
  digest: "Daily digest",
};

function ModePicker({
  label,
  modes,
  value,
  onChange,
}: {
  label: string;
  modes: readonly EmailMode[];
  value: EmailMode;
  onChange: (mode: EmailMode) => void;
}) {
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = modes.length;
    onChange(modes[(i + step + n) % n]);
    const group = e.currentTarget.parentElement;
    requestAnimationFrame(() =>
      group?.querySelectorAll<HTMLElement>('[role="radio"]')[(i + step + n) % n]?.focus()
    );
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 rounded-md border border-line-2 bg-white p-0.5"
    >
      {modes.map((mode, i) => {
        const checked = mode === value;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => !checked && onChange(mode)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "px-2.5 py-1 text-xs font-medium rounded transition-colors",
              checked ? "bg-brand-soft text-brand-700" : "text-ink-3 hover:text-ink"
            )}
          >
            {MODE_LABEL[mode]}
          </button>
        );
      })}
    </div>
  );
}

export function NotificationEmailSettings({
  modes: initialModes,
  mutedMatters: initialMuted,
  timeZone,
}: {
  modes: Record<NotificationCategory, EmailMode>;
  mutedMatters: { id: string; name: string }[];
  timeZone: string;
}) {
  const [modes, setModes] = useState(initialModes);
  const [muted, setMuted] = useState(initialMuted);
  const [, startTransition] = useTransition();

  const changeMode = (category: NotificationCategory, mode: EmailMode) => {
    const previous = modes[category];
    setModes((m) => ({ ...m, [category]: mode }));
    startTransition(async () => {
      let error: string | null = null;
      try {
        const res = await setNotificationEmailMode(category, mode);
        if (!res.ok) error = res.error;
      } catch {
        error = "Couldn't save the setting. Please try again.";
      }
      if (error) {
        setModes((m) => ({ ...m, [category]: previous }));
        notifyError(error);
      }
    });
  };

  const unmute = (matter: { id: string; name: string }) => {
    setMuted((list) => list.filter((m) => m.id !== matter.id));
    startTransition(async () => {
      let error: string | null = null;
      try {
        const res = await setMatterEmailMute(matter.id, false);
        if (!res.ok) error = res.error ?? "Couldn't unmute the matter.";
      } catch {
        error = "Couldn't unmute the matter. Please try again.";
      }
      if (error) {
        setMuted((list) =>
          [...list, matter].sort((a, b) => a.name.localeCompare(b.name))
        );
        notifyError(error);
      }
    });
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Email</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <ul className="flex flex-col divide-y divide-line">
            {NOTIFICATION_CATEGORIES.map((c) => (
              <li
                key={c.key}
                className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-ink">{c.label}</div>
                  <div className="text-2xs text-ink-3">{c.description}</div>
                  {!c.modes.includes("off") && (
                    <div className="text-2xs text-ink-4 mt-0.5">
                      Deadline reminders can&apos;t be turned off.
                    </div>
                  )}
                </div>
                <ModePicker
                  label={`${c.label} email`}
                  modes={c.modes}
                  value={modes[c.key]}
                  onChange={(mode) => changeMode(c.key, mode)}
                />
              </li>
            ))}
          </ul>
          <p className="text-2xs text-ink-4 mt-3">
            Daily digests arrive at 7:00 AM ({timeZone}), your profile time zone.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Muted matters</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {muted.length === 0 ? (
            <EmptyState
              title="No muted matters"
              description="Mute a noisy matter from the bell button on its page. Deadline reminders still arrive."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {muted.map((m) => (
                <li key={m.id} className="py-2 flex items-center justify-between gap-4">
                  <Link
                    href={`/matters/${m.id}`}
                    className="text-xs font-medium text-ink hover:text-brand-700 truncate"
                  >
                    {m.name}
                  </Link>
                  <button
                    type="button"
                    onClick={() => unmute(m)}
                    aria-label={`Unmute ${m.name}`}
                    className="shrink-0 text-xs font-medium px-2 py-1 rounded-md border border-line bg-white text-ink-3 hover:text-brand-700 hover:border-brand-300"
                  >
                    Unmute
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
