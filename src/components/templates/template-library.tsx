/**
 * Template Library — the /settings/templates list.
 *
 * Two tabs: Templates (active grouped by category, curated order first,
 * then stray categories, archived below; filterable by kind and
 * applies-to) and Blocks (reusable fragments). Rows link to the
 * full-page editors; manage affordances render only for the matching
 * permission flags and every action re-checks server-side.
 */

"use client";

import Link from "next/link";
import { useState } from "react";
import { Blocks, FileText, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import {
  APPLIES_TO_LABEL,
  TEMPLATE_CATEGORIES,
  TEMPLATE_KIND_LABEL,
  templateCategoryLabel,
} from "@/lib/template-constants";
import { APPLIES_TO, TEMPLATE_KINDS } from "@/lib/templates/schema";
import {
  deleteDocumentTemplate,
  setDocumentTemplateActive,
} from "@/app/actions/document-templates";
import { deleteTemplateBlock, setTemplateBlockActive } from "@/app/actions/template-blocks";
import { LibraryRow } from "./library-row";

export type TemplateListItem = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  kind: string;
  appliesTo: string;
  isActive: boolean;
  /** Preformatted server-side (viewer's TZ). */
  updatedAtLabel: string;
  createdByName: string | null;
};

export type BlockListItem = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  updatedAtLabel: string;
};

type Tab = "templates" | "blocks";

type Flags = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

export function TemplateLibrary({
  templates,
  blocks,
  initialTab = "templates",
  ...flags
}: Flags & {
  templates: TemplateListItem[];
  blocks: BlockListItem[];
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const tabs: { id: Tab; label: string }[] = [
    { id: "templates", label: "Templates" },
    { id: "blocks", label: "Blocks" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" className="flex gap-4 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 pb-2 text-xs font-medium",
              tab === t.id ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "templates" ? (
        <TemplatesTab templates={templates} {...flags} />
      ) : (
        <BlocksTab blocks={blocks} {...flags} />
      )}
    </div>
  );
}

function TemplatesTab({
  templates,
  canCreate,
  canEdit,
  canDelete,
}: Flags & {
  templates: TemplateListItem[];
}) {
  const [kind, setKind] = useState("all");
  const [appliesTo, setAppliesTo] = useState("all");

  const shown = templates.filter(
    (t) =>
      (kind === "all" || t.kind === kind) && (appliesTo === "all" || t.appliesTo === appliesTo),
  );
  const active = shown.filter((t) => t.isActive);
  const archived = shown.filter((t) => !t.isActive);

  // Curated category order first, then whatever else exists in data.
  const categories = [
    ...TEMPLATE_CATEGORIES.filter((c) => active.some((t) => t.category === c)),
    ...[...new Set(active.map((t) => t.category))].filter(
      (c) => !(TEMPLATE_CATEGORIES as readonly string[]).includes(c),
    ),
  ];

  const row = (t: TemplateListItem) => (
    <LibraryRow
      key={t.id}
      href={`/settings/templates/${t.id}`}
      name={t.name}
      icon={FileText}
      description={t.description}
      tags={
        <span className="text-2xs text-ink-4 shrink-0">
          {TEMPLATE_KIND_LABEL[t.kind as keyof typeof TEMPLATE_KIND_LABEL] ?? t.kind} ·{" "}
          {APPLIES_TO_LABEL[t.appliesTo as keyof typeof APPLIES_TO_LABEL] ?? t.appliesTo}
        </span>
      }
      meta={
        <>
          <span>updated {t.updatedAtLabel}</span>
          {t.createdByName && <span>by {t.createdByName}</span>}
        </>
      }
      isActive={t.isActive}
      canEdit={canEdit}
      canDelete={canDelete}
      deleteNoun="template"
      onSetActive={(a) => setDocumentTemplateActive(t.id, a)}
      onDelete={() => deleteDocumentTemplate(t.id)}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {canCreate && (
          <Button render={<Link href="/settings/templates/new" />} className="gap-2 text-xs">
            <Plus size={13} />
            New template
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <NativeSelect
            size="sm"
            aria-label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <NativeSelectOption value="all">All kinds</NativeSelectOption>
            {TEMPLATE_KINDS.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {TEMPLATE_KIND_LABEL[k]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            size="sm"
            aria-label="Applies to"
            value={appliesTo}
            onChange={(e) => setAppliesTo(e.target.value)}
          >
            <NativeSelectOption value="all">All records</NativeSelectOption>
            {APPLIES_TO.map((a) => (
              <NativeSelectOption key={a} value={a}>
                {APPLIES_TO_LABEL[a]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      {templates.length === 0 && (
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
      {templates.length > 0 && shown.length === 0 && (
        <EmptyState framed icon={FileText} title="No templates match these filters" />
      )}

      {categories.map((category) => {
        const rows = active.filter((t) => t.category === category);
        return (
          <section key={category} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-2xs font-medium text-ink-3">{templateCategoryLabel(category)}</h2>
              <span className="text-2xs font-mono text-ink-4">{rows.length}</span>
            </div>
            <div className="flex flex-col gap-1.5">{rows.map(row)}</div>
          </section>
        );
      })}

      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-2xs font-medium text-ink-3">Archived ({archived.length})</h2>
          <div className="flex flex-col gap-1.5">{archived.map(row)}</div>
        </section>
      )}
    </div>
  );
}

function BlocksTab({
  blocks,
  canCreate,
  canEdit,
  canDelete,
}: Flags & {
  blocks: BlockListItem[];
}) {
  const active = blocks.filter((b) => b.isActive);
  const archived = blocks.filter((b) => !b.isActive);

  const row = (b: BlockListItem) => (
    <LibraryRow
      key={b.id}
      href={`/settings/templates/blocks/${b.id}`}
      name={b.name}
      icon={Blocks}
      description={b.description}
      tags={<span className="text-2xs text-ink-4 font-mono shrink-0">{b.key}</span>}
      meta={<span>updated {b.updatedAtLabel}</span>}
      isActive={b.isActive}
      canEdit={canEdit}
      canDelete={canDelete}
      deleteNoun="block"
      onSetActive={(a) => setTemplateBlockActive(b.id, a)}
      onDelete={() => deleteTemplateBlock(b.id)}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-ink-4 leading-relaxed max-w-2xl">
        Blocks are reusable pieces (a signature, a letterhead, a standard paragraph) that templates
        include. Editing a block changes every template that uses it.
      </p>
      {canCreate && (
        <div>
          <Button render={<Link href="/settings/templates/blocks/new" />} className="gap-2 text-xs">
            <Plus size={13} />
            New block
          </Button>
        </div>
      )}
      {blocks.length === 0 && (
        <EmptyState
          framed
          icon={Blocks}
          title="No blocks yet"
          description="Blocks you create appear here and in the template editor's Insert block menu."
        />
      )}
      {active.length > 0 && <div className="flex flex-col gap-1.5">{active.map(row)}</div>}
      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-2xs font-medium text-ink-3">Archived ({archived.length})</h2>
          <div className="flex flex-col gap-1.5">{archived.map(row)}</div>
        </section>
      )}
    </div>
  );
}
