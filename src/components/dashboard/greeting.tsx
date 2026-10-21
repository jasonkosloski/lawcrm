/** "Tuesday, October 20 · 3 due today" line above the dashboard grid. */
export function Greeting({
  tz,
  dueToday,
}: {
  tz: string;
  dueToday: number | null;
}) {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  return (
    <p className="text-sm text-ink-3">
      {date}
      {dueToday !== null && <> &middot; {dueToday} due today</>}
    </p>
  );
}
