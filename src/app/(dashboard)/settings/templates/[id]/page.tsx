/**
 * Settings — template editor (`/settings/templates/new` creates).
 *
 * Creating needs `documents.template.create`; anyone signed in may open
 * an existing template, read-only without `documents.template.edit`.
 * Every save re-checks the key server-side.
 */

import { notFound } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { getCurrentUserPermissions, requirePermission } from "@/lib/permission-check";
import {
  loadBlockSources,
  loadEditorCourtFormats,
  loadEditorPageStyle,
  loadEditorTemplate,
} from "@/lib/templates/editor-data";
import {
  TemplateEditorPage,
  type EditorTemplate,
} from "@/components/templates/editor/template-editor-page";

const NEW_TEMPLATE: EditorTemplate = {
  id: null,
  name: "",
  category: "general",
  description: null,
  documentTitle: null,
  kind: "letter",
  appliesTo: "matter",
  content: null,
  body: null,
  subject: null,
  updatedAt: null,
};

export default async function TemplateEditorRoute({
  params,
}: PageProps<"/settings/templates/[id]">) {
  await requireUser();
  const { id } = await params;
  const isNew = id === "new";
  if (isNew) await requirePermission("documents.template.create");

  // Blocks include the style's letterhead/continuation (active and archived).
  const [{ isAdmin, granted }, template, blocks, pageStyle, courtFormats] = await Promise.all([
    getCurrentUserPermissions(),
    isNew ? NEW_TEMPLATE : loadEditorTemplate(id),
    loadBlockSources(),
    loadEditorPageStyle(),
    loadEditorCourtFormats(),
  ]);
  if (!template) notFound();
  const canSave = isNew || isAdmin || granted.has("documents.template.edit");

  return (
    <TemplateEditorPage
      key={id}
      template={template}
      blocks={blocks}
      pageStyle={pageStyle}
      courtFormats={courtFormats}
      canSave={canSave}
    />
  );
}
