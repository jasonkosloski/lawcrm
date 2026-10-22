/**
 * Live preview of the draft. Sample data renders in the browser on every
 * change; "Preview with a real matter or lead" renders the current draft
 * on the server against a picked record (`previewTemplateDraft`, which
 * checks access to it). The render report is listed under the preview.
 */

"use client";

import { useMemo, useState, useTransition } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { previewTemplateDraft } from "@/app/actions/document-templates";
import { Button } from "@/components/ui/button";
import { SAMPLE_TEMPLATE_DATA } from "@/lib/templates/catalog";
import { renderTemplate, type BlockSource, type RenderReport } from "@/lib/templates/render";
import type { AppliesTo, TemplateDoc, TemplateKind } from "@/lib/templates/schema";
import { resolvedToHtml } from "@/lib/templates/to-html";
import { resolvedToText } from "@/lib/templates/to-text";
import { RecordPicker, type PickedRecord } from "./record-picker";

type Rendered = { html: string; text: string; subjectText: string | null; report: RenderReport };

/** Client-side render with obviously-fake sample data. */
export function renderSample(
  doc: TemplateDoc,
  subject: TemplateDoc | null,
  appliesTo: AppliesTo,
  blocks: BlockSource[],
): Rendered {
  const data = {
    ...SAMPLE_TEMPLATE_DATA,
    scope: appliesTo === "lead" ? "lead" : "matter",
  } as const;
  const map = new Map(blocks.map((b) => [b.id, b]));
  const body = renderTemplate(doc, { data, blocks: map });
  const subj = subject ? renderTemplate(subject, { data, blocks: map }) : null;
  return {
    html: resolvedToHtml(body.doc),
    text: resolvedToText(body.doc),
    subjectText: subj ? resolvedToText(subj.doc) : null,
    report: body.report,
  };
}

function Report({ report }: { report: RenderReport }) {
  const rows = [
    { label: "Not on file", items: report.missing },
    { label: "Fields that don't fit", items: report.invalid },
    { label: "Archived or missing blocks", items: report.archivedBlocks },
  ].filter((r) => r.items.length > 0);
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-md bg-warn-soft px-3 py-2 text-2xs text-warn">
      {rows.map((r) => (
        <li key={r.label} className="flex gap-1.5">
          <TriangleAlert size={12} className="mt-px shrink-0" aria-hidden="true" />
          <span>
            {r.label}: {r.items.join(", ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PreviewPane({
  doc,
  subject,
  kind,
  appliesTo,
  blocks,
  allowRecord,
}: {
  doc: TemplateDoc;
  subject: TemplateDoc | null;
  kind: TemplateKind;
  appliesTo: AppliesTo;
  blocks: BlockSource[];
  /** Offer the real-record preview (desktop editors only). */
  allowRecord: boolean;
}) {
  const sample = useMemo(
    () => renderSample(doc, subject, appliesTo, blocks),
    [doc, subject, appliesTo, blocks],
  );
  const [picking, setPicking] = useState(false);
  const [record, setRecord] = useState<PickedRecord | null>(null);
  const [real, setReal] = useState<Rendered | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = (r: PickedRecord) => {
    setPicking(false);
    setRecord(r);
    setError(null);
    startTransition(async () => {
      const res = await previewTemplateDraft({
        content: doc,
        subject: kind === "email" ? subject : undefined,
        kind,
        appliesTo,
        target: { scope: r.scope },
      });
      if (res.ok) setReal(res);
      else {
        setReal(null);
        setError(res.error);
      }
    });
  };

  const shown = record ? real : sample;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-2xs text-ink-4">
        <span className="font-medium text-ink-3">Preview</span>
        <span className="truncate">{record ? record.label : "Sample data"}</span>
        {allowRecord && (
          <span className="ml-auto flex items-center gap-1">
            {record && (
              <>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Refresh preview"
                  disabled={pending}
                  onClick={() => load(record)}
                >
                  <RefreshCw size={12} />
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setRecord(null)}>
                  Sample data
                </Button>
              </>
            )}
            {!picking && (
              <Button variant="outline" size="xs" onClick={() => setPicking(true)}>
                Preview with a real matter or lead
              </Button>
            )}
          </span>
        )}
      </div>
      {picking && (
        <RecordPicker appliesTo={appliesTo} onPick={load} onCancel={() => setPicking(false)} />
      )}
      {error && <p className="text-xs text-warn">{error}</p>}
      {pending && <p className="text-xs text-ink-4">Rendering…</p>}
      {shown && (
        <>
          {kind === "email" && (
            <div className="text-xs text-ink-2">
              <span className="text-ink-4">Subject: </span>
              {shown.subjectText || "—"}
            </div>
          )}
          <div
            data-testid="template-preview"
            className="min-h-40 rounded-md border border-line bg-white px-4 py-3"
          >
            {kind === "sms" ? (
              <p className="whitespace-pre-wrap text-xs text-ink">{shown.text}</p>
            ) : (
              <div
                className="prose prose-sm max-w-none text-xs text-ink"
                // Sanitized by resolvedToHtml (sanitizeDocumentHtml).
                dangerouslySetInnerHTML={{ __html: shown.html }}
              />
            )}
          </div>
          <Report report={shown.report} />
        </>
      )}
    </div>
  );
}
