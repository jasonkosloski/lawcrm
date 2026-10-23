/**
 * Settings — Document template library
 *
 * Firm-wide library of structured templates (letters, emails, text
 * messages, filings) and the reusable blocks they include. Rows open
 * the full-page editors under /settings/templates/[id] and
 * /settings/templates/blocks/[id].
 *
 * Deliberately UNGATED for viewing: generating documents FROM
 * templates is open to anyone who can see a matter, so everyone may
 * browse what's available. Manage affordances (new / edit / archive
 * / delete) render only for holders of the documents.template.*
 * keys — and every underlying action re-checks server-side.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserPermissions } from "@/lib/permission-check";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { formatDate } from "@/lib/format-date";
import {
  TemplateLibrary,
  type BlockListItem,
  type TemplateListItem,
} from "@/components/templates/template-library";
import { requireUser } from "@/lib/current-user";
import { checkTemplateFit } from "@/lib/templates/inspect";
import type { AppliesTo, TemplateDoc } from "@/lib/templates/schema";

export default async function TemplatesSettingsPage({
  searchParams,
}: PageProps<"/settings/templates">) {
  await requireUser();
  const { tab } = await searchParams;
  const [{ isAdmin, granted }, tz] = await Promise.all([
    getCurrentUserPermissions(),
    getCurrentUserTimeZone(),
  ]);
  const can = (key: string): boolean => isAdmin || granted.has(key);

  const [templates, blocks] = await Promise.all([
    prisma.documentTemplate.findMany({
      orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        category: true,
        description: true,
        kind: true,
        appliesTo: true,
        isActive: true,
        updatedAt: true,
        createdBy: { select: { name: true } },
      },
    }),
    prisma.templateBlock.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isActive: true,
        updatedAt: true,
        appliesTo: true,
        content: true,
      },
    }),
  ]);

  const items: TemplateListItem[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
    kind: t.kind,
    appliesTo: t.appliesTo,
    isActive: t.isActive,
    updatedAtLabel: formatDate(t.updatedAt, "medium", tz),
    createdByName: t.createdBy?.name ?? null,
  }));
  const blockItems: BlockListItem[] = blocks.map((b) => ({
    id: b.id,
    key: b.key,
    name: b.name,
    description: b.description,
    isActive: b.isActive,
    updatedAtLabel: formatDate(b.updatedAt, "medium", tz),
    // Legacy blocks may predate the scope rule (e.g. "both" with a
    // matter-only field); flag them so someone fixes the scope or field.
    misfit: !checkTemplateFit(b.content as unknown as TemplateDoc, b.appliesTo as AppliesTo).ok,
  }));

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-ink">Document templates</h1>
        <p className="text-xs text-ink-4 mt-1 leading-relaxed">
          Reusable letters, emails, text messages and filings with fields that fill in from the
          matter or lead, client, and firm when you generate them. Generate from any matter&apos;s
          Documents tab. Archive a template to hide it from generation pickers without losing it.
        </p>
      </div>

      <TemplateLibrary
        key={tab === "blocks" ? "blocks" : "templates"}
        templates={items}
        blocks={blockItems}
        initialTab={tab === "blocks" ? "blocks" : "templates"}
        canCreate={can("documents.template.create")}
        canEdit={can("documents.template.edit")}
        canDelete={can("documents.template.delete")}
      />
    </div>
  );
}
