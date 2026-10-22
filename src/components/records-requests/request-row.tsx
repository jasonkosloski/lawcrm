/**
 * One row of the Records tab: a link to the request's detail page.
 */

import Link from "next/link";
import { FileText, Inbox } from "lucide-react";
import { formatDateOnly } from "@/lib/format-date";
import { scopeBasePath, type RecordScope } from "@/lib/record-scope";
import { dueBadge } from "@/lib/records-requests/due-badge";
import { isRecordsRequestOpen } from "@/lib/records-requests/status";
import type { RecordsRequestRow } from "@/lib/queries/records-requests";
import { cn } from "@/lib/utils";

export function RequestRow({ row, scope }: { row: RecordsRequestRow; scope: RecordScope }) {
  const badge = dueBadge(row);
  return (
    <li>
      <Link
        href={`${scopeBasePath(scope)}/records/${row.id}`}
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-brand-tint transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-ink truncate">{row.subject}</div>
          <div className="text-2xs text-ink-3 truncate">
            {row.custodianName} · {row.typeName}
            {row.nextFollowUpDate && isRecordsRequestOpen(row.status)
              ? ` · follow up ${formatDateOnly(row.nextFollowUpDate)}`
              : ""}
          </div>
        </div>
        {row.feeAmount && (
          <span className="text-2xs font-mono text-ink-3 shrink-0">${row.feeAmount}</span>
        )}
        <span
          className="flex items-center gap-2 text-2xs font-mono text-ink-4 shrink-0"
          title="Letters / received records"
        >
          <span className="inline-flex items-center gap-0.5">
            <FileText size={10} />
            {row.letterCount}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <Inbox size={10} />
            {row.recordsCount}
          </span>
        </span>
        {badge && (
          <span
            className={cn(
              "inline-block text-2xs font-medium px-2 py-0.5 rounded-full shrink-0",
              badge.overdue
                ? "bg-warn-soft text-warn border-warn-border"
                : "bg-paper-2 text-ink-3 border-line",
            )}
          >
            {badge.text}
          </span>
        )}
        {row.ownerInitials && (
          <span className="inline-flex items-center justify-center size-6 rounded-full bg-paper-2 border border-line text-2xs font-medium text-ink-3 shrink-0">
            {row.ownerInitials}
          </span>
        )}
      </Link>
    </li>
  );
}
