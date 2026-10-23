/**
 * Settings — block editor (`/settings/templates/blocks/new` creates).
 *
 * Same keys as templates: create for new, edit to save an existing
 * block (read-only otherwise). The header lists the templates that use
 * the block.
 */

import { notFound } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { getCurrentUserPermissions, requirePermission } from "@/lib/permission-check";
import { listBlockUsage } from "@/app/actions/template-blocks";
import {
  loadBlockSources,
  loadEditorBlock,
  loadEditorCourtFormats,
  loadEditorPageStyle,
} from "@/lib/templates/editor-data";
import {
  TemplateEditorPage,
  type EditorBlock,
} from "@/components/templates/editor/template-editor-page";

const NEW_BLOCK: EditorBlock = {
  id: null,
  key: "",
  name: "",
  description: null,
  content: null,
  updatedAt: null,
};

export default async function BlockEditorRoute({
  params,
}: PageProps<"/settings/templates/blocks/[id]">) {
  await requireUser();
  const { id } = await params;
  const isNew = id === "new";
  if (isNew) await requirePermission("documents.template.create");

  // Same page style, court formats and blocks as the template editor, so
  // blocks edit, nest and preview with the same tools.
  const [{ isAdmin, granted }, block, usage, blocks, pageStyle, courtFormats] = await Promise.all([
    getCurrentUserPermissions(),
    isNew ? NEW_BLOCK : loadEditorBlock(id),
    isNew ? [] : listBlockUsage(id),
    loadBlockSources(),
    loadEditorPageStyle(),
    loadEditorCourtFormats(),
  ]);
  if (!block) notFound();
  const canSave = isNew || isAdmin || granted.has("documents.template.edit");

  return (
    <TemplateEditorPage
      key={id}
      block={block}
      usage={usage}
      blocks={blocks}
      pageStyle={pageStyle}
      courtFormats={courtFormats}
      canSave={canSave}
    />
  );
}
