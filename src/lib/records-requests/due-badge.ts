import type { RecordsRequestRow } from "@/lib/queries/records-requests";
import { isRecordsRequestOpen } from "./status";

/** Due label for an open request with a response due date; null otherwise. */
export function dueBadge(
  r: Pick<RecordsRequestRow, "status" | "daysUntilDue">
): { text: string; overdue: boolean } | null {
  if (r.daysUntilDue === null || !isRecordsRequestOpen(r.status)) return null;
  if (r.daysUntilDue < 0) {
    return { text: `${-r.daysUntilDue}d overdue`, overdue: true };
  }
  if (r.daysUntilDue === 0) return { text: "Due today", overdue: false };
  return { text: `${r.daysUntilDue}d left`, overdue: false };
}
