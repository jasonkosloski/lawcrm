/**
 * Settings — Documents
 *
 * The firm's house style for generated letters and filings (font,
 * margins, letterhead, logo, continuation header, page numbers)
 * with a live sample page, then the named paragraph styles. Viewable by any signed-in member; editing
 * needs `firm.edit_document_style` (every action and the logo route
 * re-check it).
 */

import { DocumentSettings } from "@/components/settings/document-settings";
import { requireUser } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { SAMPLE_TEMPLATE_DATA } from "@/lib/templates/catalog";
import { getDocumentStyle } from "@/lib/templates/document-style";
import { renderTemplate, type BlockSource, type ResolvedDoc } from "@/lib/templates/render";
import { SAMPLE_LETTER_DOC } from "@/lib/templates/sample-letter";
import type { TemplateDoc } from "@/lib/templates/schema";

export default async function DocumentSettingsPage() {
  await requireUser();
  const [style, canEdit, blockRows] = await Promise.all([
    getDocumentStyle(),
    currentUserHasPermission("firm.edit_document_style"),
    prisma.templateBlock.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isActive: true, content: true },
    }),
  ]);

  const sources = new Map<string, BlockSource>(
    blockRows.map((b) => [b.id, { ...b, content: b.content as unknown as TemplateDoc }]),
  );
  const data = { ...SAMPLE_TEMPLATE_DATA, scope: "matter" as const };
  const ctx = { data, blocks: sources, styles: style.paragraphStyles };
  const body = renderTemplate(SAMPLE_LETTER_DOC, ctx).doc;
  // Every block a select can offer, rendered the same way as the body.
  const blockDocs: Record<string, ResolvedDoc> = {};
  for (const b of blockRows) {
    if (b.isActive || b.id === style.letterheadBlockId || b.id === style.continuationBlockId) {
      blockDocs[b.id] = renderTemplate(b.content as unknown as TemplateDoc, ctx).doc;
    }
  }

  const { id: _id, updatedAt, logoKey, logoContentType: _ct, ...values } = style;
  void _id;
  void _ct;

  return (
    <div className="max-w-6xl">
      <div className="mb-4">
        <h1 className="text-base font-semibold text-ink">Documents</h1>
        <p className="mt-1 text-xs text-ink-3">
          The house style for letters and filings generated from templates, in Word and PDF.
          {!canEdit && " You can view the style but not change it."}
        </p>
      </div>
      <DocumentSettings
        updatedAt={updatedAt.toISOString()}
        houseStyle={{
          initial: values,
          hasLogo: logoKey !== null,
          blocks: blockRows.map(({ id, name, isActive }) => ({ id, name, isActive })),
          body,
          blockDocs,
          canEdit,
        }}
        paragraphStyles={{
          initial: values.paragraphStyles,
          fontKey: values.fontKey,
          canEdit,
        }}
      />
    </div>
  );
}
