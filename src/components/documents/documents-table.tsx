/**
 * The Documents tab's file list: a folder's subfolders and files as a
 * selectable, draggable table (see documents-workspace.tsx).
 *
 * - Click a row to select it, ⌘/Ctrl-click to add, shift-click for a
 *   range, or use the checkboxes. The name link still opens the item;
 *   double-clicking a row does too.
 * - Drag rows onto a folder row, a tree folder or a breadcrumb to move
 *   them. Folder rows are drop targets.
 * - Keyboard: ↑/↓ move, shift+↑/↓ extend, space toggles, ↵ opens,
 *   F2 renames, ⌫/Delete deletes, ⌘A selects all, Esc clears.
 */

"use client";

import { useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { FileText, Folder, Mail, Paperclip } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DocTarget, FolderTarget } from "@/lib/document-entry-actions";
import { type EntryKey } from "@/lib/document-selection";
import { EntryKebab } from "./entry-menu";
import { dropStateClass, useFolderDropTarget, useWorkspace } from "./workspace-context";

export type FolderRowData = {
  key: EntryKey;
  target: FolderTarget;
  /** Direct file count. */
  count: number;
  /** Server-rendered badges after the name. */
  extras: ReactNode;
};

export type DocRowData = {
  key: EntryKey;
  target: DocTarget;
  /** The email this attachment sits under (hidden with it mid-move). */
  parentKey: EntryKey | null;
  isEmail: boolean;
  extras: ReactNode;
  category: string;
  status: { label: string; className: string };
  size: string;
  uploaderInitials: string | null;
  uploaderName: string | null;
  added: string;
};

export type RowData = FolderRowData | DocRowData;

const isFolderRow = (r: RowData): r is FolderRowData => r.target.kind === "folder";

/** Clicks on these keep their own behaviour (unless a modifier is held
 *  on the name link, which selects instead). */
const INTERACTIVE = "a, button, input, [role='checkbox'], [role='menuitem']";

export function DocumentsTable({ rows }: { rows: RowData[] }) {
  const ws = useWorkspace()!;
  const visible = rows.filter(
    (r) =>
      !ws.hidden.has(r.key) &&
      !(
        r.target.kind === "doc" &&
        (r as DocRowData).parentKey &&
        ws.hidden.has((r as DocRowData).parentKey!)
      ),
  );
  const order = visible.map((r) => r.key);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const focusRow = (key: EntryKey) =>
    bodyRef.current?.querySelector<HTMLElement>(`[data-entry-key="${CSS.escape(key)}"]`)?.focus();

  const targetsOf = (keys: Iterable<EntryKey>) => {
    const set = new Set(keys);
    return visible.filter((r) => set.has(r.key)).map((r) => r.target);
  };

  const runShortcut = (id: Parameters<typeof ws.run>[0], keys: Iterable<EntryKey>) => {
    const targets = targetsOf(keys);
    if (targets.length === 0) return false;
    if (!ws.actionsFor(targets).some((a) => a.id === id)) return false;
    ws.run(id, targets);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-entry-key]");
    if (!row || (e.target as HTMLElement).closest("input, [role='menu']")) return;
    const key = row.dataset.entryKey as EntryKey;
    const i = order.indexOf(key);
    const sel = ws.selection.keys.has(key) ? ws.selection.keys : new Set([key]);
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        const next = order[e.key === "ArrowDown" ? i + 1 : i - 1];
        if (!next) return;
        e.preventDefault();
        if (e.shiftKey) ws.select(next, { toggle: false, range: true });
        focusRow(next);
        return;
      }
      case " ":
        // The checkbox toggles itself.
        if ((e.target as HTMLElement).closest("[role='checkbox']")) return;
        e.preventDefault();
        ws.select(key, { toggle: true, range: e.shiftKey });
        return;
      case "Enter":
        if ((e.target as HTMLElement).tagName === "A") return;
        e.preventDefault();
        runShortcut("open", [key]);
        return;
      case "F2": {
        e.preventDefault();
        const t = targetsOf([key])[0];
        if (t) runShortcut(t.kind === "doc" ? "edit" : "rename", [key]);
        return;
      }
      case "Delete":
      case "Backspace":
        if ((e.target as HTMLElement).closest("[role='checkbox']")) return;
        e.preventDefault();
        runShortcut("delete", sel);
        return;
      case "Escape":
        if (ws.selection.keys.size > 0) {
          e.preventDefault();
          ws.setSelection([]);
        }
        return;
      case "a":
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          ws.setSelection(order);
        }
        return;
    }
  };

  const allSelected = order.length > 0 && order.every((k) => ws.selection.keys.has(k));
  const someSelected = !allSelected && order.some((k) => ws.selection.keys.has(k));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4 w-8">
            <Checkbox
              aria-label={allSelected ? "Clear selection" : "Select all"}
              checked={allSelected}
              indeterminate={someSelected}
              onCheckedChange={() => ws.setSelection(allSelected ? [] : order)}
            />
          </TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>By</TableHead>
          <TableHead>Added</TableHead>
          <TableHead className="pr-4 w-8" />
        </TableRow>
      </TableHeader>
      <TableBody ref={bodyRef} onKeyDown={onKeyDown}>
        {visible.map((r) =>
          isFolderRow(r) ? <FolderRow key={r.key} row={r} /> : <DocRow key={r.key} row={r} />,
        )}
      </TableBody>
    </Table>
  );
}

/** Row behaviour shared by folders and files: selection clicks, open on
 *  double-click, drag handle. */
function useEntryRow(key: EntryKey, draggable: boolean) {
  const ws = useWorkspace()!;
  const drag = useDraggable({ id: key, disabled: !draggable });
  const selected = ws.selection.keys.has(key);

  const onClick = (e: MouseEvent<HTMLElement>) => {
    const mods = { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey };
    const interactive = (e.target as HTMLElement).closest(INTERACTIVE);
    if (interactive) {
      // ⌘/shift on the name selects instead of opening a tab/window.
      if (interactive.tagName === "A" && (mods.toggle || mods.range)) {
        e.preventDefault();
        ws.select(key, mods);
      }
      return;
    }
    ws.select(key, mods);
  };

  const onDoubleClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    // Plain navigation: the link is the canonical way in.
    (e.currentTarget.querySelector("a[data-entry-link]") as HTMLAnchorElement | null)?.click();
  };

  return {
    selected,
    dragging: !!ws.dragging?.keys.has(key),
    setDragRef: drag.setNodeRef,
    rowProps: {
      "data-entry-key": key,
      "data-selected": selected || undefined,
      tabIndex: -1,
      onClick,
      onDoubleClick,
      // Pointer listeners only: dnd-kit's role/tabIndex attributes would
      // turn the row into a button and break the table's semantics.
      ...drag.listeners,
    },
    checkbox: (
      <Checkbox
        aria-label="Select"
        checked={selected}
        onCheckedChange={(_checked, details) =>
          ws.select(key, {
            toggle: true,
            range: (details.event as unknown as MouseEvent)?.shiftKey ?? false,
          })
        }
      />
    ),
  };
}

const rowClass = (selected: boolean, dragging: boolean) =>
  cn(
    "select-none outline-none focus-visible:bg-paper-2 data-[selected]:bg-brand-soft/60",
    selected && "hover:bg-brand-soft/80",
    dragging && "opacity-40",
  );

function FolderRow({ row }: { row: FolderRowData }) {
  const ws = useWorkspace()!;
  const t = row.target;
  const { selected, dragging, setDragRef, rowProps, checkbox } = useEntryRow(
    row.key,
    ws.perms.organize && !t.isProtected,
  );
  const { setNodeRef, dropProps, state } = useFolderDropTarget(t.id, "row");
  return (
    <TableRow
      ref={(el) => {
        setDragRef(el);
        setNodeRef(el);
      }}
      {...rowProps}
      {...dropProps}
      className={cn(rowClass(selected, dragging), dropStateClass(state))}
    >
      <TableCell className="pl-4 w-8">{checkbox}</TableCell>
      <TableCell className="font-medium text-ink">
        <Link
          href={t.href}
          data-entry-link
          draggable={false}
          className="inline-flex items-center gap-2 hover:text-brand-700"
        >
          <Folder size={14} className="shrink-0 text-ink-4" />
          {t.name}
          {row.count > 0 && (
            <span className="text-2xs font-mono font-normal text-ink-4">
              {row.count} file{row.count === 1 ? "" : "s"}
            </span>
          )}
        </Link>
        {row.extras}
      </TableCell>
      <TableCell className="text-2xs font-mono text-ink-4">Folder</TableCell>
      <TableCell className="text-2xs text-ink-4">—</TableCell>
      <TableCell className="text-2xs text-ink-4">—</TableCell>
      <TableCell className="text-2xs text-ink-4">—</TableCell>
      <TableCell className="text-2xs text-ink-4">—</TableCell>
      <TableCell className="pr-4 text-right">
        <EntryKebab target={t} />
      </TableCell>
    </TableRow>
  );
}

function DocRow({ row }: { row: DocRowData }) {
  const ws = useWorkspace()!;
  const t = row.target;
  const { selected, dragging, setDragRef, rowProps, checkbox } = useEntryRow(
    row.key,
    ws.perms.organize && !t.isAttachment,
  );
  const Icon = t.isAttachment ? Paperclip : row.isEmail ? Mail : FileText;
  return (
    <TableRow ref={setDragRef} {...rowProps} className={rowClass(selected, dragging)}>
      <TableCell className="pl-4 w-8">{checkbox}</TableCell>
      <TableCell className={t.isAttachment ? "pl-8 font-medium text-ink" : "font-medium text-ink"}>
        <Link
          href={t.href}
          data-entry-link
          draggable={false}
          className="inline-flex items-center gap-2 hover:text-brand-700 hover:underline"
          title="Open document"
        >
          <Icon size={14} className="shrink-0 text-ink-4" />
          {t.name}
        </Link>
        {row.extras}
      </TableCell>
      <TableCell className="text-xs text-ink-3">{row.category}</TableCell>
      <TableCell>
        <span
          className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full ${row.status.className}`}
        >
          {row.status.label}
        </span>
      </TableCell>
      <TableCell className="text-2xs font-mono text-ink-3">{row.size}</TableCell>
      <TableCell className="text-2xs font-mono text-ink-3">
        <span title={row.uploaderName ?? undefined}>{row.uploaderInitials ?? "—"}</span>
      </TableCell>
      <TableCell className="text-xs text-ink-3">{row.added}</TableCell>
      <TableCell className="pr-4 text-right">
        <EntryKebab target={t} />
      </TableCell>
    </TableRow>
  );
}
