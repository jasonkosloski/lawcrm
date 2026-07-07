/**
 * Matter Detail — Documents tab
 *
 * Filings, pleadings, correspondence, contracts, discovery, and
 * expert reports for this matter. Grouped by category. Per-row:
 * download (if the file actually exists) + delete (admin or
 * uploader). Inline upload composer at the top.
 */

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UploadDocumentForm } from "@/components/matters/documents/upload-document-form";
import { DocumentRowActions } from "@/components/matters/documents/document-row-actions";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { formatDate } from "@/lib/format-date";
import { currentUserHasPermission } from "@/lib/permission-check";
import {
  getMatterDocuments,
  type DocumentRow,
} from "@/lib/queries/matter-detail";

const CATEGORY_ORDER = [
  "filing",
  "pleading",
  "discovery",
  "expert_report",
  "correspondence",
  "contract",
  "intake",
  "evidence",
  "vendor",
  "archive",
  "other",
];

const CATEGORY_LABEL: Record<string, string> = {
  filing: "Filings",
  pleading: "Pleadings",
  correspondence: "Correspondence",
  contract: "Contracts",
  intake: "Intake",
  discovery: "Discovery",
  expert_report: "Expert reports",
  evidence: "Evidence",
  vendor: "Vendor",
  archive: "Archive",
  other: "Other",
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: {
    label: "Active",
    className: "bg-paper-2 text-ink-3 border-line",
  },
  filed: {
    label: "Filed",
    className: "bg-ok-soft text-ok border-line",
  },
  received: {
    label: "Received",
    className: "bg-brand-soft text-brand-700 border-brand-200",
  },
  review: {
    label: "Under review",
    className: "bg-warn-soft text-warn border-warn-border",
  },
  archived: {
    label: "Archived",
    className: "bg-paper-2 text-ink-4 border-line",
  },
};

const formatSize = (bytes: number | null): string => {
  if (bytes === null || bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default async function MatterDocumentsPage({
  params,
}: PageProps<"/matters/[id]">) {
  const { id } = await params;
  const [documents, currentUserId, canDeleteAny, tz] = await Promise.all([
    getMatterDocuments(id),
    getCurrentUserId(),
    currentUserHasPermission("documents.delete_any"),
    // Upload timestamps are real instants — render them on the
    // viewer's calendar, not the server's (UTC in prod).
    getCurrentUserTimeZone(),
  ]);

  if (documents.length === 0) {
    return (
      <div className="p-5 flex flex-col gap-4">
        <Card>
          <CardContent className="p-8 text-center flex flex-col items-center gap-3">
            <div>
              <div className="text-sm font-semibold text-ink mb-1">
                No documents yet
              </div>
              <div className="text-xs text-ink-3">
                Filings, pleadings, correspondence, contracts, discovery,
                and expert reports for this matter will appear here.
              </div>
            </div>
          </CardContent>
        </Card>
        <UploadDocumentForm matterId={id} />
      </div>
    );
  }

  const byCategory = new Map<string, DocumentRow[]>();
  for (const d of documents) {
    if (!byCategory.has(d.category)) byCategory.set(d.category, []);
    byCategory.get(d.category)!.push(d);
  }
  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return (
    <div className="p-5 flex flex-col gap-5">
      {orderedCategories.map((category) => {
        const rows = byCategory.get(category)!;
        return (
          <section key={category}>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
                {CATEGORY_LABEL[category] ?? category}
              </h2>
              <span className="text-2xs font-mono text-ink-4">
                {rows.length}
              </span>
            </div>
            <Card className="p-0 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="pr-4 w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((d) => {
                    const status = STATUS_META[d.status] ?? STATUS_META.active;
                    const canDelete =
                      canDeleteAny || d.uploadedBy === currentUserId;
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="pl-4 font-medium text-ink">
                          {d.hasFile ? (
                            <a
                              href={`/api/documents/${d.id}/download`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-brand-700 hover:underline"
                              title="Open or download"
                            >
                              {d.name}
                            </a>
                          ) : (
                            <span title="No file attached — seeded row.">
                              {d.name}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-2xs font-mono text-ink-4">
                          {d.source ?? "—"}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border ${status.className}`}
                          >
                            {status.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-2xs font-mono text-ink-3">
                          {formatSize(d.fileSize)}
                        </TableCell>
                        <TableCell className="text-2xs font-mono text-ink-3">
                          {d.uploaderInitials ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-ink-3">
                          {formatDate(d.createdAt, "medium", tz)}
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          {d.hasFile && (
                            <DocumentRowActions
                              documentId={d.id}
                              name={d.name}
                              canDelete={canDelete}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </section>
        );
      })}

      <UploadDocumentForm matterId={id} />
    </div>
  );
}
