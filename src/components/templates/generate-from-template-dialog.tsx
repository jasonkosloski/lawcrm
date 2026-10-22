/**
 * Generate From Template — dialog on the matter Documents tab.
 *
 * Pick an active template (grouped by category) → the dialog fetches
 * a live preview merged against the REAL matter context via the
 * `documents.upload`-gated `previewDocumentFromTemplate` action, surfacing
 * missing-data placeholders and unknown-token warnings. From there:
 *
 *   - "Copy text" — clipboard (nothing is written). The dialog is
 *     only rendered for holders of `documents.upload`, which the
 *     preview action requires.
 *   - "Save to documents" — calls the `documents.upload`-gated
 *     generate action, which stores the result as a .docx file and
 *     creates the Document row. The button renders only when the
 *     caller holds the permission (server re-checks regardless).
 */

"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Copy, Sparkles, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import type { RecordScope } from "@/lib/record-scope";
import { STALE_TEMPLATE, templateCategoryLabel } from "@/lib/template-constants";
import {
  generateDocumentFromTemplate,
  previewDocumentFromTemplate,
  type TemplatePreviewResult,
} from "@/app/actions/document-templates";
import { FormErrorBanner } from "@/components/ui/field";

export type TemplateOption = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  /** When present, the picker only offers document kinds that fit the scope. */
  kind?: string;
  appliesTo?: string;
};

export type SignerOption = { id: string; name: string };
export type RecipientOption = { id: string; name: string; role: string | null };

const DOCUMENT_KINDS = ["letter", "filing"];

export function GenerateFromTemplateDialog({
  scope,
  templates,
  canUpload,
  recordsRequestId,
  defaultTemplateId,
  triggerLabel = "Generate from template",
  folderId = null,
  team = [],
  contacts = [],
  currentUserId = "",
}: {
  scope: RecordScope;
  /** Active templates only — the picker never offers archived ones. */
  templates: TemplateOption[];
  /** Whether the viewer holds `documents.upload` (gates the save
   *  affordance; callers only render the dialog for holders, since
   *  the preview action needs the same key). */
  canUpload: boolean;
  /** Merge against, and file the saved letter on, this records request. */
  recordsRequestId?: string;
  /** Template to preselect (and preview) on open, when still offered. */
  defaultTemplateId?: string | null;
  triggerLabel?: string;
  /** Folder the document is saved into (the one open in the browser). */
  folderId?: string | null;
  /** Active team members plus the current user - signer choices. */
  team?: SignerOption[];
  /** Contacts the server accepts as a recipient on this record. */
  contacts?: RecipientOption[];
  /** Default signer. */
  currentUserId?: string;
}) {
  const fitting = scope.kind === "lead" ? ["lead", "both"] : ["matter", "both"];
  const offered = templates.filter(
    (t) =>
      (t.kind === undefined || DOCUMENT_KINDS.includes(t.kind)) &&
      (t.appliesTo === undefined || fitting.includes(t.appliesTo)),
  );
  const [signerId, setSignerId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const buildOpts = (signer: string, recipient: string) => {
    const o: { recordsRequestId?: string; signerId?: string; recipientContactId?: string } = {};
    if (recordsRequestId) o.recordsRequestId = recordsRequestId;
    if (signer) o.signerId = signer;
    if (recipient) o.recipientContactId = recipient;
    return Object.keys(o).length > 0 ? o : undefined;
  };
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const noun = scope.kind === "lead" ? "intake" : "matter";
  const [preview, setPreview] = useState<TemplatePreviewResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Name of the Document just saved - shown in place of silently
  // closing, since the file lands at the root list.
  const [savedName, setSavedName] = useState<string | null>(null);
  const [previewPending, startPreview] = useTransition();
  const [savePending, startSave] = useTransition();

  // Only the latest preview request may land (slow older responses lose).
  const previewSeq = useRef(0);
  // Kept from the last ok preview so the selects survive a refused re-preview.
  const [needs, setNeeds] = useState({ signer: false, recipient: false });
  const runPreview = (id: string, signer: string, recipient: string, keepNotice = false) => {
    const seq = ++previewSeq.current;
    startPreview(async () => {
      const o = buildOpts(signer, recipient);
      const res = await (o
        ? previewDocumentFromTemplate(id, scope, o)
        : previewDocumentFromTemplate(id, scope));
      if (seq !== previewSeq.current) return;
      if (res.ok) {
        setNeeds({ signer: res.needsSigner, recipient: res.needsRecipient });
        if (!keepNotice) setStaleNotice(null);
      }
      setPreview(res);
    });
  };

  const onPick = (id: string) => {
    previewSeq.current++;
    setNeeds({ signer: false, recipient: false });
    setTemplateId(id);
    setPreview(null);
    setSaveError(null);
    setStaleNotice(null);
    setSavedName(null);
    setCopied(false);
    setCopyError(false);
    setSignerId("");
    setRecipientId("");
    if (!id) return;
    runPreview(id, "", "");
  };

  const onSigner = (id: string) => {
    setSignerId(id);
    if (templateId) runPreview(templateId, id, recipientId);
  };
  const onRecipient = (id: string) => {
    setRecipientId(id);
    if (templateId) runPreview(templateId, signerId, id);
  };

  // Reset per open so a stale preview never flashes; a request's
  // default template is preselected and previewed straight away.
  const openDialog = () => {
    previewSeq.current++;
    setNeeds({ signer: false, recipient: false });
    setTemplateId("");
    setPreview(null);
    setCopied(false);
    setCopyError(false);
    setSaveError(null);
    setSavedName(null);
    setStaleNotice(null);
    setSignerId("");
    setRecipientId("");
    setOpen(true);
    if (defaultTemplateId && offered.some((t) => t.id === defaultTemplateId)) {
      onPick(defaultTemplateId);
    }
  };

  const onCopy = async () => {
    if (!preview?.ok) return;
    // writeText rejects on permission denial / lost focus, and
    // navigator.clipboard is undefined on non-secure origins - never
    // let the user paste a stale clipboard believing it worked.
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(preview.text);
      setCopyError(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };

  const onSave = () => {
    if (!templateId || !preview?.ok) return;
    setSaveError(null);
    startSave(async () => {
      // The preview's template version: generation refuses if the
      // template changed after the user reviewed it.
      const res = await generateDocumentFromTemplate(templateId, scope, {
        ...(recordsRequestId ? { recordsRequestId } : { folderId }),
        ...(preview.needsSigner ? { signerId: signerId || currentUserId || undefined } : {}),
        ...(preview.needsRecipient && recipientId ? { recipientContactId: recipientId } : {}),
        expectedUpdatedAt: preview.templateUpdatedAt,
      });
      if (res.ok) {
        // The action revalidated the documents route. The document is
        // filed at the root, which is invisible if a subfolder
        // is open - so confirm by name instead of closing silently.
        setSavedName(res.documentName);
      } else if (res.error === STALE_TEMPLATE) {
        // Refresh the preview (and its version) so the next save is valid.
        setStaleNotice(res.error);
        runPreview(templateId, signerId, recipientId, true);
      } else {
        setSaveError(res.error);
      }
    });
  };

  // Group the picker's options by category, data order preserved.
  const grouped = new Map<string, TemplateOption[]>();
  for (const t of offered) {
    if (!grouped.has(t.category)) grouped.set(t.category, []);
    grouped.get(t.category)!.push(t);
  }

  const warnings =
    preview?.ok &&
    (preview.report.missing.length > 0 ||
      preview.report.invalid.length > 0 ||
      preview.report.archivedBlocks.length > 0)
      ? preview.report
      : null;

  return (
    <>
      <Button
        variant="outline"
        type="button"
        onClick={openDialog}
        className="gap-2 text-xs border-dashed"
      >
        <Sparkles size={13} />
        {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Generate from template</DialogTitle>
            <DialogDescription>
              Merge fields fill in from this {noun}, its client, and your firm. Review the preview,
              then save it to the Documents tab or copy the text.
            </DialogDescription>
          </DialogHeader>

          {offered.length === 0 ? (
            <div className="px-3 py-6 rounded-md border border-line bg-paper-2/40 text-xs text-ink-3 text-center">
              No active templates yet. Add some under{" "}
              <span className="font-medium text-ink-2">Settings → Document templates</span>.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="generate-template" className="text-xs font-medium text-ink-2">
                  Template
                </label>
                <NativeSelect
                  id="generate-template"
                  value={templateId}
                  onChange={(e) => onPick(e.target.value)}
                  className="w-full"
                >
                  <NativeSelectOption value="">Pick a template…</NativeSelectOption>
                  {[...grouped.entries()].map(([category, rows]) => (
                    <NativeSelectOptGroup key={category} label={templateCategoryLabel(category)}>
                      {rows.map((t) => (
                        <NativeSelectOption key={t.id} value={t.id}>
                          {t.name}
                          {t.description ? ` — ${t.description}` : ""}
                        </NativeSelectOption>
                      ))}
                    </NativeSelectOptGroup>
                  ))}
                </NativeSelect>
              </div>

              {(needs.signer || needs.recipient) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {needs.signer && (
                    <div className="flex flex-col gap-1">
                      <label htmlFor="generate-signer" className="text-xs font-medium text-ink-2">
                        Signer
                      </label>
                      <NativeSelect
                        id="generate-signer"
                        value={signerId || currentUserId}
                        onChange={(e) => onSigner(e.target.value)}
                        className="w-full"
                      >
                        {team.map((u) => (
                          <NativeSelectOption key={u.id} value={u.id}>
                            {u.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                  )}
                  {needs.recipient && (
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="generate-recipient"
                        className="text-xs font-medium text-ink-2"
                      >
                        Recipient
                      </label>
                      <NativeSelect
                        id="generate-recipient"
                        value={recipientId}
                        onChange={(e) => onRecipient(e.target.value)}
                        className="w-full"
                      >
                        <NativeSelectOption value="">Pick a recipient…</NativeSelectOption>
                        {contacts.map((c) => (
                          <NativeSelectOption key={c.id} value={c.id}>
                            {c.name}
                            {c.role ? ` — ${c.role}` : ""}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                  )}
                </div>
              )}

              {previewPending && (
                <div className="px-3 py-6 rounded-md border border-line bg-paper-2/40 text-xs text-ink-4 text-center">
                  Merging {noun} data…
                </div>
              )}

              {!previewPending && preview && !preview.ok && (
                <FormErrorBanner message={preview.error} />
              )}

              <FormErrorBanner message={staleNotice} />

              {!previewPending && preview?.ok && (
                <>
                  {warnings && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
                      <TriangleAlert size={12} className="shrink-0 mt-px" />
                      <div className="flex flex-col gap-0.5">
                        {warnings.missing.length > 0 && (
                          <span>
                            Missing: {warnings.missing.join(", ")} — visible placeholders are left
                            in the document.
                          </span>
                        )}
                        {warnings.invalid.length > 0 && (
                          <span>
                            Fields that don&apos;t apply here: {warnings.invalid.join(", ")}
                          </span>
                        )}
                        {warnings.archivedBlocks.length > 0 && (
                          <span>Archived blocks: {warnings.archivedBlocks.join(", ")}</span>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="px-3 py-2.5 rounded-md border border-line bg-paper-2/40 max-h-72 overflow-y-auto">
                    <div
                      className="prose prose-sm max-w-none text-xs text-ink"
                      // Sanitized by resolvedToHtml (sanitizeDocumentHtml).
                      dangerouslySetInnerHTML={{ __html: preview.html }}
                    />
                  </div>
                </>
              )}

              {copyError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
                  <TriangleAlert size={12} className="shrink-0 mt-px" />
                  <span>Couldn&apos;t copy — select the preview text and copy it manually.</span>
                </div>
              )}

              {savedName && (
                <div
                  role="status"
                  className="flex items-start gap-2 px-3 py-2 rounded-md bg-paper-2/40 border border-line text-2xs text-ink-2"
                >
                  <Check size={12} className="shrink-0 mt-px" />
                  <span>
                    Saved as <span className="font-medium">{savedName}</span>{" "}
                    {folderId && !recordsRequestId
                      ? "in the folder you have open."
                      : `in All documents (the ${noun}'s root list — switch folders to see it).`}
                  </span>
                </div>
              )}

              <FormErrorBanner message={saveError} />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {savedName ? "Done" : "Cancel"}
            </Button>
            {offered.length > 0 && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!preview?.ok || previewPending}
                  onClick={onCopy}
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy text"}
                </Button>
                {canUpload && !savedName && (
                  <Button
                    type="button"
                    disabled={!preview?.ok || previewPending || savePending}
                    onClick={onSave}
                  >
                    {savePending ? "Saving…" : "Save to documents"}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
