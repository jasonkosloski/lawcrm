/**
 * Upload Document Composer
 *
 * Inline file picker for the Documents tab. Collapsed: a single
 * "Upload document" button. Expanded: native file input + optional
 * display-name override + category dropdown + submit. On success
 * the action revalidates the documents page and we collapse back.
 *
 * Multi-file is deliberately deferred — the action takes one file
 * per submit, which keeps the form simple and the error path clear.
 * Multi-file lands when there's a real demand signal.
 */

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, TriangleAlert, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadDocument } from "@/app/actions/documents";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABEL,
  MAX_DOCUMENT_BYTES,
  documentInitialState,
  type DocumentCategory,
  type DocumentFormState,
} from "@/lib/document-form";

const MAX_MB = Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024));

export function UploadDocumentForm({ matterId }: { matterId: string }) {
  const action = uploadDocument.bind(null, matterId);
  const [state, formAction, isPending] = useActionState<
    DocumentFormState,
    FormData
  >(action, documentInitialState);
  const [expanded, setExpanded] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [category, setCategory] = useState<DocumentCategory>("other");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Collapse + reset on successful upload.
  useEffect(() => {
    if (state.status === "ok") {
      setExpanded(false);
      setFilename(null);
      setCategory("other");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [state.status]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          "inline-flex items-center gap-2 h-9 px-3 text-xs",
          "rounded-md border border-dashed border-line bg-white",
          "hover:border-brand-300 hover:text-brand-700 transition-colors text-ink-3"
        )}
      >
        <Plus size={13} />
        Upload document
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 p-4 rounded-md border border-line bg-paper-2/40"
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          File <span className="text-warn">*</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            required
            onChange={(e) => setFilename(e.target.files?.[0]?.name ?? null)}
            className={cn(
              "block w-full text-xs text-ink-3",
              "file:mr-3 file:py-1.5 file:px-3 file:rounded-md",
              "file:border-0 file:text-xs file:font-medium",
              "file:bg-brand-500 file:text-white file:cursor-pointer",
              "hover:file:bg-brand-600"
            )}
          />
        </div>
        <span className="text-[10px] text-ink-4 leading-relaxed">
          Max {MAX_MB} MB. PDFs preview inline; everything else downloads.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Display name (optional)
          </label>
          <input
            name="name"
            type="text"
            placeholder={filename ?? "Falls back to the file's name"}
            maxLength={200}
            className="h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Category
          </label>
          <select
            name="category"
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentCategory)}
            className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
          >
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {DOCUMENT_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {state.status === "error" && state.error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setFilename(null);
          }}
          className="text-2xs text-ink-3 hover:text-ink-2 px-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
            "bg-brand-500 text-white hover:bg-brand-600 transition-colors",
            "disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          <Upload size={12} />
          {isPending ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  );
}
