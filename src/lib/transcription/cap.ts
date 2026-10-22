import { instantInTz } from "../format-date";

/** True once usage has reached the monthly cap. */
export function capExceeded(usedSeconds: number, capHours: number): boolean {
  return usedSeconds >= capHours * 3600;
}

/** UTC instant of midnight on the 1st of `now`'s month, in `tz`. */
export function monthStart(now: Date, tz: string): Date {
  const [y, m] = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);
  return instantInTz(y, m, 1, 0, 0, tz);
}
