/** "Shared with you": documents the firm has shared, each a download link. */

import { Download, Inbox } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate } from "@/lib/format-date";
import type { PortalDocumentRow } from "@/lib/portal/document-visibility.server";

export function formatBytes(n: number | null): string | null {
  if (n == null) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function SharedSection({ documents }: { documents: PortalDocumentRow[] }) {
  return (
    <section aria-labelledby="shared-heading" className="flex flex-col gap-3">
      <h2 id="shared-heading" className="text-sm font-semibold text-ink-2">
        Shared with you
      </h2>
      {documents.length === 0 ? (
        <EmptyState framed icon={Inbox} title="Nothing shared yet" className="bg-white py-8" />
      ) : (
        <ul className="divide-y divide-line-2 overflow-hidden rounded-xl bg-white shadow-xs ring-1 ring-line">
          {documents.map((d) => (
            <li key={d.id}>
              <a
                href={`/api/documents/${d.id}/download`}
                className="group flex min-h-16 items-center gap-4 px-5 py-3 outline-none hover:bg-brand-tint focus-visible:bg-brand-tint focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-ink group-hover:text-brand-700">
                    {d.name}
                  </span>
                  <span className="text-xs text-ink-3">
                    {[formatDate(d.createdAt, "medium", "America/Denver"), formatBytes(d.fileSize)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <Download className="size-4 shrink-0 text-ink-4" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
