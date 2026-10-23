/**
 * Email and text-message templates — fill a template against a matter or
 * lead for the compose / reply editors and the "Text from template" dialog.
 *
 * Nothing is written here: the caller puts the result into a draft (email)
 * or copies it (text). Gates mirror where the result goes:
 *   - email templates need `communication.send_email` (Compose's own key);
 *   - text templates need `communication.log_call` (the texting / call-log
 *     key — texts are copied to a phone or logged, never sent from here).
 * Record data comes from the same access-checked loader as documents
 * (`loadTemplateData`), so a template can't pull data from a walled record.
 * The signer is always the person composing.
 */

"use server";

import { prisma } from "@/lib/prisma";
import { assertScopeAccess } from "@/lib/scope-access";
import { currentUserHasPermission } from "@/lib/permission-check";
import type { RecordScope } from "@/lib/record-scope";
import { loadTemplateData } from "@/lib/templates/load-data";
import { contentOf, loadBlockMap } from "@/lib/templates/template-source";
import { renderTemplate, type BlockSource, type RenderReport } from "@/lib/templates/render";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import { mergeReport } from "@/lib/templates/page-render";
import { usesRecipient } from "@/lib/templates/inspect";
import { resolvedToHtml } from "@/lib/templates/to-html";
import { resolvedToText } from "@/lib/templates/to-text";
import { messageTemplateWhere } from "@/lib/templates/picker";
import { loadGenerateOptions, type RecipientOption } from "@/lib/templates/generate-options";
import type { TemplateDoc } from "@/lib/templates/schema";

export type MessageKind = "email" | "sms";

const PERMISSION: Record<MessageKind, string> = {
  email: "communication.send_email",
  sms: "communication.log_call",
};
const DENIED: Record<MessageKind, string> = {
  email: "You don't have permission to send email.",
  sms: "You don't have permission to log texts.",
};

export type MessageTemplateOption = { id: string; name: string; category: string };

export type MessageTemplateOptions =
  | { ok: true; templates: MessageTemplateOption[]; recipients: RecipientOption[] }
  | { ok: false; error: string };

/** The templates of `kind` that fit the record, plus the record's contacts
 *  (the same set the loader accepts as recipients). */
export async function listMessageTemplateOptions(
  kind: MessageKind,
  scope: RecordScope,
): Promise<MessageTemplateOptions> {
  if (!(await currentUserHasPermission(PERMISSION[kind]))) {
    return { ok: false, error: DENIED[kind] };
  }
  const [templates, options] = await Promise.all([
    prisma.documentTemplate.findMany({
      where: messageTemplateWhere(kind, scope.kind),
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { id: true, name: true, category: true },
    }),
    // Access-checks the record before reading its contacts.
    loadGenerateOptions(scope),
  ]);
  return { ok: true, templates, recipients: options.contacts };
}

export type RenderedMessage = {
  ok: true;
  kind: MessageKind;
  templateName: string;
  /** Email only: the filled-in subject line. */
  subject: string | null;
  /** Sanitized HTML of the body (email). */
  html: string;
  /** Plain text of the body (texts, and the email text part). */
  text: string;
  report: RenderReport;
  needsRecipient: boolean;
  /** Email only: the template uses formatting the email editor drops
   *  (tables, alignment, underline, top-level headings). */
  dropsFormatting: boolean;
};

export type RenderMessageResult = RenderedMessage | { ok: false; error: string };

/** Formatting the email editor (notes profile) can't keep: tables,
 *  non-left alignment, top-level headings, underline — in the template or
 *  any block it inserts. */
function usesUnsupportedEmailFormatting(
  doc: TemplateDoc,
  blocks: Map<string, BlockSource>,
): boolean {
  const unsupported = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return false;
    const n = node as {
      type?: string;
      attrs?: Record<string, unknown>;
      marks?: { type: string }[];
      content?: unknown[];
    };
    if (n.type === "table") return true;
    const align = n.attrs?.textAlign;
    if ((n.type === "paragraph" || n.type === "heading") && align && align !== "left") return true;
    if (n.type === "heading" && n.attrs?.level === 1) return true;
    if (n.marks?.some((m) => m.type === "underline")) return true;
    if (n.type === "block" && typeof n.attrs?.blockId === "string") {
      const block = blocks.get(n.attrs.blockId);
      if (block && unsupported(block.content)) return true;
    }
    return (n.content ?? []).some(unsupported);
  };
  return unsupported(doc);
}

/** Fill an email or text template against a record. */
export async function renderMessageTemplate(
  templateId: string,
  scope: RecordScope,
  opts: { recipientContactId?: string | null } = {},
): Promise<RenderMessageResult> {
  await assertScopeAccess(scope);
  const template = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    select: {
      name: true,
      kind: true,
      appliesTo: true,
      content: true,
      body: true,
      subject: true,
      isActive: true,
    },
  });
  if (!template || !template.isActive) {
    return { ok: false, error: "Template not found or archived." };
  }
  if (template.kind !== "email" && template.kind !== "sms") {
    return { ok: false, error: "This template isn't an email or text template." };
  }
  const kind: MessageKind = template.kind;
  if (!(await currentUserHasPermission(PERMISSION[kind]))) {
    return { ok: false, error: DENIED[kind] };
  }
  if (template.appliesTo !== "both" && template.appliesTo !== scope.kind) {
    return {
      ok: false,
      error: `This template is for ${template.appliesTo === "lead" ? "leads" : "matters"} only.`,
    };
  }

  const content = contentOf(template);
  const subjectDoc =
    kind === "email" && template.subject ? (template.subject as unknown as TemplateDoc) : null;
  const [blocks, loaded] = await Promise.all([
    loadBlockMap(content),
    loadTemplateData({ scope, recipientContactId: opts.recipientContactId ?? null }),
  ]);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const ctx = { data: loaded.data, blocks, styles: DEFAULT_PARAGRAPH_STYLES };
  const body = renderTemplate(content, ctx);
  const subject = subjectDoc ? renderTemplate(subjectDoc, ctx) : null;
  const report = body.report;
  if (subject) mergeReport(report, subject.report);

  return {
    ok: true,
    kind,
    templateName: template.name,
    subject: subject ? resolvedToText(subject.doc).trim() : null,
    html: kind === "email" ? resolvedToHtml(body.doc) : "",
    text: resolvedToText(body.doc),
    report,
    needsRecipient: usesRecipient(content, blocks),
    dropsFormatting: kind === "email" && usesUnsupportedEmailFormatting(content, blocks),
  };
}
