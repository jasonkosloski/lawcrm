/** "Your uploads": files clients sent, plus the general uploader. */

import { FileUp } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate } from "@/lib/format-date";
import type { PortalUploadRow } from "@/lib/portal/document-visibility.server";
import type { StorageDriver } from "@/lib/storage/storage-key";
import { PortalUploader } from "./portal-uploader";
import { formatBytes } from "./shared-section";

export function UploadsSection({
  uploads,
  matterId,
  storageDriver,
}: {
  uploads: PortalUploadRow[];
  matterId: string;
  storageDriver: StorageDriver;
}) {
  return (
    <section aria-labelledby="uploads-heading" className="flex flex-col gap-3">
      <h2 id="uploads-heading" className="text-sm font-semibold text-ink-2">
        Your uploads
      </h2>
      <PortalUploader matterId={matterId} storageDriver={storageDriver} label="Upload files" />
      {uploads.length === 0 ? (
        <EmptyState
          framed
          icon={FileUp}
          title="You haven't uploaded anything yet"
          className="bg-white py-8"
        />
      ) : (
        <ul className="divide-y divide-line-2 overflow-hidden rounded-xl bg-white shadow-xs ring-1 ring-line">
          {uploads.map((u) => (
            <li key={u.id}>
              <a
                href={`/api/documents/${u.id}/download`}
                className="flex min-h-16 flex-col justify-center px-5 py-3 outline-none hover:bg-brand-tint focus-visible:bg-brand-tint focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset"
              >
                <span className="truncate text-sm font-medium text-ink">{u.name}</span>
                <span className="text-xs text-ink-3">
                  {[
                    u.requestTitle ? `For: ${u.requestTitle}` : null,
                    formatDate(u.createdAt, "medium", "America/Denver"),
                    formatBytes(u.fileSize),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
