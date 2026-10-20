"use client";

import { useEffect, useState } from "react";

/** The firm's zone (no per-firm zone field yet; same as the seed/portal). */
const FIRM_ZONE = "America/Denver";

/**
 * Format an instant the way a clerk's date stamp reads, in Denver time:
 * `{ date: "Oct. 20, 2026", time: "3:52 p.m. MDT" }`. Abbreviated
 * months take a period ("Sept." stays "Sep.", "May" takes none).
 */
export function formatReceivedStamp(at: Date): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: FIRM_ZONE,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  const month = parts.month === "May" ? "May" : `${parts.month}.`;
  const meridiem = parts.dayPeriod?.toLowerCase() === "am" ? "a.m." : "p.m.";
  return {
    date: `${month} ${parts.day}, ${parts.year}`,
    time: `${parts.hour}:${parts.minute} ${meridiem} ${parts.timeZoneName}`,
  };
}

/**
 * The clerk's RECEIVED stamp on the login sheet, showing the current
 * Denver date and time. Server-rendered so it reads correctly without
 * script; ticks on the client so a tab left open stays current.
 */
export function ReceivedStamp() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  const { date, time } = formatReceivedStamp(now);

  return (
    <p
      aria-label={`Received ${date}, ${time}, Denver, Colorado`}
      className="inline-flex shrink-0 -rotate-[5deg] flex-col items-center rounded-[3px] border-[3px] border-brand-500 px-4 py-2 text-center text-brand-500 mix-blend-multiply animate-in fade-in zoom-in-[160%] fill-mode-both delay-700 duration-300 ease-out motion-reduce:animate-none"
    >
      <span className="text-lg font-bold leading-tight tracking-[0.06em]">
        RECEIVED
      </span>
      <span
        suppressHydrationWarning
        className="text-base font-semibold leading-snug tabular-nums"
      >
        {date}
      </span>
      <span suppressHydrationWarning className="text-base leading-snug tabular-nums">
        {time}
      </span>
      <span className="text-base leading-snug">Denver, Colo.</span>
    </p>
  );
}
