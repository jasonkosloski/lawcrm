/** "Where things stand": the latest status update from the firm, then earlier ones. */

import { EmptyState } from "@/components/shared/empty-state";
import { formatDate } from "@/lib/format-date";
import type { PortalStatusUpdateView } from "@/lib/portal/status";
import { MessageSquareText } from "lucide-react";

/** Same default zone as the rest of the portal (clients have no profile zone). */
const PORTAL_TIME_ZONE = "America/Denver";

function postedLabel(u: PortalStatusUpdateView): string {
  return formatDate(u.postedAt, "medium", PORTAL_TIME_ZONE);
}

export function StatusSection({
  updates,
}: {
  updates: PortalStatusUpdateView[];
}) {
  const [latest, ...earlier] = updates;
  return (
    <section aria-labelledby="status-heading" className="flex flex-col gap-3">
      <h2 id="status-heading" className="text-sm font-semibold text-ink-2">
        Where things stand
      </h2>
      {!latest ? (
        <EmptyState
          framed
          icon={MessageSquareText}
          title="Your legal team hasn't posted an update yet."
          className="bg-white py-8"
        />
      ) : (
        <div className="flex flex-col gap-3 rounded-xl bg-white p-5 shadow-xs ring-1 ring-line">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-line bg-paper-2 px-2.5 py-0.5 text-xs font-medium text-ink-2">
              {latest.stageLabel}
            </span>
            <span className="text-sm text-ink-3">
              Updated {postedLabel(latest)}
              {latest.edited ? " (edited)" : ""}
            </span>
          </div>
          <p className="text-sm whitespace-pre-line text-ink-2">
            {latest.body}
          </p>
        </div>
      )}

      {earlier.length > 0 ? (
        <details className="group rounded-xl bg-white shadow-xs ring-1 ring-line">
          <summary className="flex min-h-12 cursor-pointer items-center px-5 py-3 text-sm font-medium text-ink-2">
            Earlier updates
          </summary>
          <ul className="divide-y divide-line-2 border-t border-line-2">
            {earlier.map((u) => (
              <li key={u.id} className="flex flex-col gap-1 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-line bg-paper-2 px-2.5 py-0.5 text-xs font-medium text-ink-2">
                    {u.stageLabel}
                  </span>
                  <span className="text-sm text-ink-3">
                    {postedLabel(u)}
                    {u.edited ? " (edited)" : ""}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-line text-ink-2">
                  {u.body}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
