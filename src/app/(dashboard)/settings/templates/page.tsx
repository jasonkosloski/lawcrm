/**
 * Settings — Document template library
 *
 * Firm-wide library of reusable document templates (demand letters,
 * discovery, retainers…) with {{merge.field}} tokens resolved at
 * generation time (see src/lib/template-merge.ts).
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
  type TemplateListItem,
} from "@/components/templates/template-library";

export default async function TemplatesSettingsPage() {
  const [templates, { isAdmin, granted }, tz] = await Promise.all([
    prisma.documentTemplate.findMany({
      orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        category: true,
        description: true,
        body: true,
        isActive: true,
        updatedAt: true,
        createdBy: { select: { name: true } },
      },
    }),
    getCurrentUserPermissions(),
    getCurrentUserTimeZone(),
  ]);

  const can = (key: string): boolean => isAdmin || granted.has(key);
  const items: TemplateListItem[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
    body: t.body,
    isActive: t.isActive,
    updatedAtLabel: formatDate(t.updatedAt, "medium", tz),
    createdByName: t.createdBy?.name ?? null,
  }));

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-ink">Document templates</h1>
        <p className="text-xs text-ink-4 mt-1 leading-relaxed">
          Reusable letters and filings with{" "}
          <code className="font-mono text-2xs bg-paper-2 px-1 py-0.5 rounded">
            {"{{merge.fields}}"}
          </code>{" "}
          that fill in from the matter, client, and firm at generation
          time. Generate from any matter&apos;s Documents tab. Archive a
          template to hide it from generation pickers without losing it.
        </p>
      </div>

      <TemplateLibrary
        templates={items}
        canCreate={can("documents.template.create")}
        canEdit={can("documents.template.edit")}
        canDelete={can("documents.template.delete")}
      />
    </div>
  );
}
