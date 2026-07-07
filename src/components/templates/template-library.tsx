/**
 * Template Library — grouped list for /settings/templates.
 *
 * Active templates grouped by category (curated order first, any
 * stray categories after), archived section below. Manage buttons
 * render only when the corresponding permission flag is passed in;
 * the server actions re-check regardless. Editing happens in
 * TemplateEditorDialog, kept mounted here so create + edit share
 * one instance.
 */

"use client";

import { useState, useTransition } from "react";
import {
  Archive,
  ArchiveRestore,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  TEMPLATE_CATEGORIES,
  templateCategoryLabel,
} from "@/lib/template-constants";
import {
  deleteDocumentTemplate,
  setDocumentTemplateActive,
} from "@/app/actions/document-templates";
import { TemplateEditorDialog } from "@/components/templates/template-editor-dialog";

export type TemplateListItem = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  body: string;
  isActive: boolean;
  /** Preformatted server-side (viewer's TZ). */
  updatedAtLabel: string;
  createdByName: string | null;
};

export function TemplateLibrary({
  templates,
  canCreate,
  canEdit,
  canDelete,
}: {
  templates: TemplateListItem[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  // null = create mode; a row = edit mode.
  const [editing, setEditing] = useState<TemplateListItem | null>(null);

  const active = templates.filter((t) => t.isActive);
  const archived = templates.filter((t) => !t.isActive);

  // Curated category order first, then whatever else exists in data.
  const categories = [
    ...TEMPLATE_CATEGORIES.filter((c) =>
      active.some((t) => t.category === c)
    ),
    ...[...new Set(active.map((t) => t.category))].filter(
      (c) => !(TEMPLATE_CATEGORIES as readonly string[]).includes(c)
    ),
  ];

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (t: TemplateListItem) => {
    setEditing(t);
    setEditorOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      {canCreate && (
        <div>
          <button
            type="button"
            onClick={openCreate}
            className={cn(
              "inline-flex items-center gap-2 h-9 px-3 text-xs font-medium",
              "rounded-md bg-brand-500 text-white hover:bg-brand-600 transition-colors"
            )}
          >
            <Plus size={13} />
            New template
          </button>
        </div>
      )}

      {active.length === 0 && archived.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={FileText}
              title="No templates yet"
              description={
                canCreate
                  ? "Create your first template above — demand letters, retainers, and discovery cover letters are good starters."
                  : "Once someone with the template-create permission adds templates, they'll appear here and in every matter's Generate-from-template picker."
              }
            />
          </CardContent>
        </Card>
      )}

      {categories.map((category) => {
        const rows = active.filter((t) => t.category === category);
        return (
          <section key={category} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-2xs font-mono uppercase tracking-wider text-ink-4">
                {templateCategoryLabel(category)}
              </h2>
              <span className="text-2xs font-mono text-ink-4">
                {rows.length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {rows.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onEdit={() => openEdit(t)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Archived ({archived.length})
          </h2>
          <div className="flex flex-col gap-1.5">
            {archived.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                canEdit={canEdit}
                canDelete={canDelete}
                onEdit={() => openEdit(t)}
                muted
              />
            ))}
          </div>
        </section>
      )}

      <TemplateEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        template={editing}
      />
    </div>
  );
}

function TemplateRow({
  template,
  canEdit,
  canDelete,
  onEdit,
  muted,
}: {
  template: TemplateListItem;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  muted?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const onToggleArchive = () => {
    startTransition(async () => {
      const res = await setDocumentTemplateActive(
        template.id,
        !template.isActive
      );
      if (!res.ok) alert(res.error ?? "Couldn't update template.");
    });
  };

  const onDelete = () => {
    if (
      !confirm(
        `Permanently delete "${template.name}"?\n\nThis can't be undone. Documents already generated from it are untouched. Prefer Archive unless the template was a mistake.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await deleteDocumentTemplate(template.id);
      if (!res.ok) alert(res.error ?? "Couldn't delete template.");
    });
  };

  const showMenu = canEdit || canDelete;

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-md border border-line bg-white",
        muted && "opacity-70"
      )}
    >
      <FileText size={14} className="text-ink-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-ink truncate">
            {template.name}
          </span>
          {!template.isActive && (
            <span className="text-2xs text-ink-4 font-mono shrink-0">
              archived
            </span>
          )}
        </div>
        {template.description && (
          <div className="text-2xs text-ink-4 truncate">
            {template.description}
          </div>
        )}
      </div>

      <div className="hidden sm:flex flex-col items-end text-2xs text-ink-4 font-mono shrink-0">
        <span>updated {template.updatedAtLabel}</span>
        {template.createdByName && <span>by {template.createdByName}</span>}
      </div>

      {showMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`Actions for ${template.name}`}
                disabled={pending}
                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
              >
                <MoreHorizontal size={14} />
              </button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-44">
            {canEdit && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil />
                Edit
              </DropdownMenuItem>
            )}
            {canEdit && (
              <DropdownMenuItem onClick={onToggleArchive}>
                {template.isActive ? <Archive /> : <ArchiveRestore />}
                {template.isActive ? "Archive" : "Restore"}
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                {canEdit && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2 />
                  Delete permanently
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
