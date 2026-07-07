/**
 * Generate From Template — dialog on the matter Documents tab.
 *
 * Pick an active template (grouped by category) → the dialog fetches
 * a live preview merged against the REAL matter context via the
 * ungated `previewDocumentFromTemplate` action, surfacing
 * missing-data placeholders and unknown-token warnings. From there:
 *
 *   - "Copy text" — clipboard, available to everyone (preview is
 *     ungated; nothing is written).
 *   - "Save to documents" — calls the `documents.upload`-gated
 *     generate action, which stores the text as a .md file and
 *     creates the Document row. The button renders only when the
 *     caller holds the permission (server re-checks regardless).
 */

"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Sparkles, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { templateCategoryLabel } from "@/lib/template-constants";
import {
  generateDocumentFromTemplate,
  previewDocumentFromTemplate,
  type TemplatePreviewResult,
} from "@/app/actions/document-templates";

export type TemplateOption = {
  id: string;
  name: string;
  category: string;
  description: string | null;
};

export function GenerateFromTemplateDialog({
  matterId,
  templates,
  canUpload,
}: {
  matterId: string;
  /** Active templates only — the picker never offers archived ones. */
  templates: TemplateOption[];
  /** Whether the viewer holds `documents.upload` (gates the save
   *  affordance; preview + copy stay available to everyone). */
  canUpload: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [preview, setPreview] = useState<TemplatePreviewResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewPending, startPreview] = useTransition();
  const [savePending, startSave] = useTransition();

  // Reset per open so a stale preview never flashes — render-phase
  // reset (React's "adjusting state when a prop changes" pattern)
  // instead of an effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setTemplateId("");
      setPreview(null);
      setCopied(false);
      setSaveError(null);
    }
  }

  const onPick = (id: string) => {
    setTemplateId(id);
    setPreview(null);
    setSaveError(null);
    setCopied(false);
    if (!id) return;
    startPreview(async () => {
      const res = await previewDocumentFromTemplate(id, matterId);
      setPreview(res);
    });
  };

  const onCopy = async () => {
    if (!preview?.ok) return;
    await navigator.clipboard.writeText(preview.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onSave = () => {
    if (!templateId) return;
    setSaveError(null);
    startSave(async () => {
      const res = await generateDocumentFromTemplate(templateId, matterId);
      if (res.ok) {
        // The action revalidated the documents route — closing is
        // enough for the new row to be visible.
        setOpen(false);
      } else {
        setSaveError(res.error);
      }
    });
  };

  // Group the picker's options by category, data order preserved.
  const grouped = new Map<string, TemplateOption[]>();
  for (const t of templates) {
    if (!grouped.has(t.category)) grouped.set(t.category, []);
    grouped.get(t.category)!.push(t);
  }

  const warnings =
    preview?.ok && (preview.missing.length > 0 || preview.unresolved.length > 0)
      ? preview
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 h-9 px-3 text-xs",
          "rounded-md border border-dashed border-line bg-white",
          "hover:border-brand-300 hover:text-brand-700 transition-colors text-ink-3"
        )}
      >
        <Sparkles size={13} />
        Generate from template
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Generate from template</DialogTitle>
            <DialogDescription>
              Merge fields fill in from this matter, its client, and your
              firm. Review the preview, then save it to the Documents tab
              or copy the text.
            </DialogDescription>
          </DialogHeader>

          {templates.length === 0 ? (
            <div className="px-3 py-6 rounded-md border border-line bg-paper-2/40 text-xs text-ink-3 text-center">
              No active templates yet. Add some under{" "}
              <span className="font-medium text-ink-2">
                Settings → Document templates
              </span>
              .
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="generate-template"
                  className="text-2xs font-mono uppercase tracking-wider text-ink-4"
                >
                  Template
                </label>
                <select
                  id="generate-template"
                  value={templateId}
                  onChange={(e) => onPick(e.target.value)}
                  className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
                >
                  <option value="">Pick a template…</option>
                  {[...grouped.entries()].map(([category, rows]) => (
                    <optgroup
                      key={category}
                      label={templateCategoryLabel(category)}
                    >
                      {rows.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.description ? ` — ${t.description}` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {previewPending && (
                <div className="px-3 py-6 rounded-md border border-line bg-paper-2/40 text-xs text-ink-4 text-center">
                  Merging matter data…
                </div>
              )}

              {!previewPending && preview && !preview.ok && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
                  <TriangleAlert size={12} className="shrink-0 mt-px" />
                  <span>{preview.error}</span>
                </div>
              )}

              {!previewPending && preview?.ok && (
                <>
                  {warnings && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
                      <TriangleAlert size={12} className="shrink-0 mt-px" />
                      <div className="flex flex-col gap-0.5">
                        {warnings.missing.length > 0 && (
                          <span>
                            Not on file for this matter:{" "}
                            {warnings.missing.join(", ")} — visible
                            placeholders are left in the text.
                          </span>
                        )}
                        {warnings.unresolved.length > 0 && (
                          <span>
                            Unknown fields (left as-is):{" "}
                            {warnings.unresolved
                              .map((k) => `{{${k}}}`)
                              .join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="px-3 py-2.5 rounded-md border border-line bg-paper-2/40 max-h-72 overflow-y-auto">
                    <div className="text-xs text-ink whitespace-pre-wrap leading-relaxed">
                      {preview.text}
                    </div>
                  </div>
                </>
              )}

              {saveError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
                  <TriangleAlert size={12} className="shrink-0 mt-px" />
                  <span>{saveError}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {templates.length > 0 && (
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
                {canUpload && (
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
