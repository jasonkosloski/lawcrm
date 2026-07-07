/**
 * Contacts directory table (desktop) with bulk selection.
 *
 * Client component so the checkbox column can hold selection as
 * plain React state — deliberately NOT in the URL (a half-built
 * selection isn't shareable state, and reloading should clear it).
 * The selection is pruned against the rows actually rendered, so a
 * search/filter change under a live selection can't smuggle hidden
 * ids into a bulk action. Merged / inactive contacts never appear
 * here (`listContacts` filters `isActive`), so every visible row is
 * selectable; the server actions still re-validate.
 *
 * Bulk bar (appears above the table when anything is selected):
 *   - Set type…  — contacts.edit, one updateMany server-side
 *   - Export CSV — no permission (read-only), server builds the file
 *   - Deactivate — contacts.delete, soft-delete, confirm() first
 *     (same confirm() idiom as the single-row delete button)
 * Batches are capped at BULK_CONTACT_LIMIT; past that the bar swaps
 * the actions for a "trim your selection" note (the server enforces
 * the same cap).
 *
 * The mobile card list stays server-rendered in the page — bulk
 * selection is a desktop-table affordance.
 */

"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmailLink } from "@/components/ui/email-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BULK_CONTACT_LIMIT,
  CONTACT_TYPES,
  CONTACT_TYPE_LABEL,
} from "@/lib/contact-constants";
// Type-only import — erased at build time, so it doesn't pull the
// Prisma-backed queries module into the client bundle.
import type { ContactListRow } from "@/lib/queries/contacts";
import {
  bulkDeactivateContacts,
  bulkSetContactType,
  exportContactsCsv,
} from "@/app/actions/contacts";

/** Trigger a browser download of an in-memory CSV. */
function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ContactsTable({
  rows,
  canEdit,
  canDelete,
}: {
  rows: ContactListRow[];
  /** contacts.edit — shows the bulk "Set type…" control. */
  canEdit: boolean;
  /** contacts.delete — shows the bulk "Deactivate" control. */
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Effective selection = checked ∩ visible. Ids that dropped out of
  // the row set (filter changed, row deactivated elsewhere) don't
  // count and are never sent to an action.
  const selected = useMemo(
    () => rows.filter((r) => selectedIds.has(r.id)),
    [rows, selectedIds]
  );
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const overLimit = selected.length > BULK_CONTACT_LIMIT;

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(rows.map((r) => r.id)) : new Set());
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectedIdList = () => selected.map((r) => r.id);

  const runSetType = (type: string) => {
    if (!type) return;
    startTransition(async () => {
      const res = await bulkSetContactType(selectedIdList(), type);
      if (!res.ok) {
        alert(res.error ?? "Something went wrong");
        return;
      }
      clearSelection();
      router.refresh();
    });
  };

  const runDeactivate = () => {
    const n = selected.length;
    if (
      !confirm(
        `Deactivate ${n} contact${n === 1 ? "" : "s"}?\n\nThey will be removed from the directory but kept on any matters where they appear so historical records aren't broken.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await bulkDeactivateContacts(selectedIdList());
      if (!res.ok) {
        alert(res.error ?? "Something went wrong");
        return;
      }
      clearSelection();
      router.refresh();
    });
  };

  const runExport = () => {
    startTransition(async () => {
      const res = await exportContactsCsv(selectedIdList());
      if (!res.ok) {
        alert(res.error ?? "Something went wrong");
        return;
      }
      downloadCsv(res.csv, res.filename);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5">
          <span className="text-xs font-medium text-ink">
            {selected.length} selected
          </span>
          <button
            type="button"
            onClick={clearSelection}
            className="text-2xs text-ink-4 hover:text-ink"
          >
            Clear
          </button>

          <div className="ml-auto flex items-center gap-2">
            {overLimit ? (
              <span className="text-2xs text-warn">
                Bulk actions run on up to {BULK_CONTACT_LIMIT} contacts at a
                time — trim the selection.
              </span>
            ) : (
              <>
                {canEdit && (
                  <select
                    aria-label="Set type"
                    value=""
                    disabled={pending}
                    onChange={(e) => runSetType(e.target.value)}
                    className="h-7 px-2 rounded-md border border-line bg-white text-2xs text-ink focus:outline-none focus:border-brand-500"
                  >
                    <option value="" disabled>
                      Set type…
                    </option>
                    {CONTACT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {CONTACT_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={runExport}
                  disabled={pending}
                >
                  <Download />
                  Export CSV
                </Button>
                {canDelete && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={runDeactivate}
                    disabled={pending}
                  >
                    <UserX />
                    Deactivate
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 pl-4">
                <Checkbox
                  aria-label="Select all contacts"
                  checked={allSelected}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="pr-4 text-right">Matters</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow
                key={c.id}
                data-selected={selectedIds.has(c.id) || undefined}
                className="data-selected:bg-brand-50/50"
              >
                <TableCell className="pl-4">
                  <Checkbox
                    aria-label={`Select ${c.name}`}
                    checked={selectedIds.has(c.id)}
                    onCheckedChange={(checked) =>
                      toggleRow(c.id, checked === true)
                    }
                  />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/contacts/${c.id}`}
                    className="text-xs font-medium text-ink hover:text-brand-700"
                  >
                    {c.name}
                  </Link>
                  {c.conflictStatus === "flagged" && (
                    <span className="ml-2 text-2xs font-medium text-warn">
                      conflict
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-2xs text-ink-3">
                  {CONTACT_TYPE_LABEL[
                    c.type as keyof typeof CONTACT_TYPE_LABEL
                  ] ?? c.type}
                </TableCell>
                <TableCell className="text-xs text-ink-3">
                  {c.organization ?? "—"}
                </TableCell>
                <TableCell className="text-2xs font-mono">
                  {c.email ? (
                    <EmailLink email={c.email} />
                  ) : (
                    <span className="text-ink-4">—</span>
                  )}
                </TableCell>
                <TableCell className="text-2xs font-mono text-ink-3">
                  {c.phone ?? "—"}
                </TableCell>
                <TableCell className="pr-4 text-right text-xs font-mono text-ink-3">
                  {c.matterCount > 0 ? c.matterCount : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
