/** "Requested from you": open requests with an uploader each, then submitted and done. */

import { CheckCircle2, ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDateOnly, parseDateOnly } from "@/lib/format-date";
import type { PortalRequest, PortalRequestGroups } from "@/lib/portal/requests";
import type { StorageDriver } from "@/lib/storage/storage-key";
import { PortalUploader } from "./portal-uploader";

function dueLabel(dueDate: string | null): string | null {
  if (!dueDate) return null;
  const d = parseDateOnly(dueDate);
  return d ? `Due ${formatDateOnly(d, "medium")}` : null;
}

export function RequestsSection({
  requests,
  matterId,
  storageDriver,
}: {
  requests: PortalRequestGroups;
  matterId: string;
  storageDriver: StorageDriver;
}) {
  const { open, submitted, done } = requests;
  return (
    <section aria-labelledby="requests-heading" className="flex flex-col gap-3">
      <h2 id="requests-heading" className="text-sm font-semibold text-ink-2">
        Requested from you
      </h2>
      {open.length === 0 && submitted.length === 0 ? (
        <EmptyState
          framed
          icon={ClipboardList}
          title="Nothing requested right now"
          className="bg-white py-8"
        />
      ) : null}

      {open.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {open.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-3 rounded-xl bg-white p-5 shadow-xs ring-1 ring-line"
            >
              <RequestHeader r={r} />
              {r.returnNote ? (
                <p className="rounded-lg border border-warn-border bg-warn-soft px-3 py-2 text-sm text-warn">
                  {r.returnNote}
                </p>
              ) : null}
              <PortalUploader
                matterId={matterId}
                requestId={r.id}
                storageDriver={storageDriver}
                label="Upload files"
              />
            </li>
          ))}
        </ul>
      ) : null}

      {submitted.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {submitted.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-1 rounded-xl bg-white p-5 shadow-xs ring-1 ring-line"
            >
              <span className="font-display text-base font-medium text-ink">
                {r.title}
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-ink-3">
                <CheckCircle2 className="size-4 text-ok" aria-hidden="true" />
                Received, the firm is reviewing
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {done.length > 0 ? (
        <details className="group rounded-xl bg-white shadow-xs ring-1 ring-line">
          <summary className="flex min-h-12 cursor-pointer items-center px-5 py-3 text-sm font-medium text-ink-2">
            Done ({done.length})
          </summary>
          <ul className="divide-y divide-line-2 border-t border-line-2">
            {done.map((r) => (
              <li key={r.id} className="px-5 py-3 text-sm text-ink-3">
                {r.title}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function RequestHeader({ r }: { r: PortalRequest }) {
  const due = dueLabel(r.dueDate);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-base font-medium text-ink">
          {r.title}
        </span>
        {r.overdue ? (
          <span className="rounded-full border border-warn-border bg-warn-soft px-2.5 py-0.5 text-xs font-medium text-warn">
            Overdue
          </span>
        ) : null}
      </div>
      {due ? <span className="text-sm text-ink-3">{due}</span> : null}
      {r.instructions ? (
        <p className="text-sm whitespace-pre-line text-ink-2">
          {r.instructions}
        </p>
      ) : null}
    </div>
  );
}
