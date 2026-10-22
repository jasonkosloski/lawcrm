/**
 * Renders an action list (src/lib/document-entry-actions.ts) as menu
 * items. The row kebab (a dropdown) and the right-click menu (a context
 * menu) both use it: Base UI's two menus share the same Item.
 */

"use client";

import { Fragment } from "react";
import {
  CheckSquare,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderInput,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActionTarget, EntryAction, EntryActionId } from "@/lib/document-entry-actions";
import { useWorkspace } from "./workspace-context";

export const ACTION_ICONS: Record<EntryActionId, LucideIcon> = {
  open: FolderOpen,
  "open-new-tab": ExternalLink,
  download: Download,
  "new-folder": FolderPlus,
  upload: Upload,
  edit: Pencil,
  rename: Pencil,
  move: FolderInput,
  copy: Copy,
  share: Eye,
  unshare: EyeOff,
  "select-all": CheckSquare,
  delete: Trash2,
};

export function EntryMenuItems({
  actions,
  onRun,
}: {
  actions: EntryAction[];
  onRun: (id: EntryActionId) => void;
}) {
  return actions.map((a, i) => {
    const Icon = ACTION_ICONS[a.id];
    const prev = actions[i - 1];
    return (
      <Fragment key={a.id}>
        {prev && prev.group !== a.group && <DropdownMenuSeparator />}
        <DropdownMenuItem
          variant={a.destructive ? "destructive" : "default"}
          onClick={() => onRun(a.id)}
        >
          <Icon />
          {a.label}
          {a.shortcut && <DropdownMenuShortcut>{a.shortcut}</DropdownMenuShortcut>}
        </DropdownMenuItem>
      </Fragment>
    );
  });
}

/** The ⋯ button at the end of a row: the same list as a right-click. */
export function EntryKebab({ target }: { target: ActionTarget }) {
  const ws = useWorkspace();
  if (!ws) return null;
  // Open lives on the row itself; the kebab starts at the real actions.
  const actions = ws.actionsFor([target]).filter((a) => a.id !== "open");
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={target.kind === "doc" ? "Document actions" : "Folder actions"}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink"
          >
            <MoreHorizontal size={14} />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-52">
        <EntryMenuItems actions={actions} onRun={(id) => ws.run(id, [target])} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
