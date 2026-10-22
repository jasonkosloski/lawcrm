/**
 * Upload Document Composer
 *
 * Inline single-file picker for the Documents tab. Collapsed: a
 * single "Upload document" button. Expanded: native file input +
 * optional display-name override + category dropdown + submit. On
 * success the page refreshes and the composer collapses.
 *
 * TRANSPORT: the file bytes never ride a server action - Next caps
 * action bodies at 1 MB and Vercel caps any function body near
 * 4.5 MB, so a 25 MB complaint would fail into the error boundary.
 * Instead, like the multi-file uploader, the composer picks its pipe
 * from the active storage driver (passed by the server page):
 *
 *   - local       → POST /api/documents/upload (streaming busboy
 *                   route) with `name` + `category` form fields
 *                   after `matterId` and before the file part.
 *   - vercel-blob → client-direct `upload()`; name + category travel
 *                   in the signed clientPayload and the completion
 *                   callback writes them to the Document row.
 *
 * The 25 MB composer cap is pre-checked client-side so an oversize
 * file fails instantly with an inline message.
 *
 * Composer uploads land at the matter root (use "Upload files" to
 * target a folder). Multi-file is handled by MultiFileUpload.
 */

"use client";

import { scopeWhere, type RecordScope } from "@/lib/record-scope";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, TriangleAlert, Upload } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { cn } from "@/lib/utils";
import { contentTypeForFilename } from "@/app/api/documents/upload/upload-config";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABEL,
  MAX_DOCUMENT_BYTES,
  parseUploadMeta,
  type DocumentCategory,
} from "@/lib/document-form";
import { makeStorageKey, type StorageDriver } from "@/lib/storage/storage-key";
import { blobUploadErrorMessage } from "./upload-errors";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

const MAX_MB = Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024));

const NETWORK_ERROR = "Upload failed - check your connection and try again.";

export function UploadDocumentForm({
  scope,
  storageDriver,
}: {
  scope: RecordScope;
  /** Which transport to use - from `activeStorageDriver()` on the
   *  server. Defaults to local. */
  storageDriver?: StorageDriver;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [category, setCategory] = useState<DocumentCategory>("other");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ids = useId();
  const fileId = `${ids}-file`;
  const nameId = `${ids}-name`;
  const categoryId = `${ids}-category`;

  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    []
  );

  const collapse = () => {
    setExpanded(false);
    setFilename(null);
    setCategory("other");
    setError(null);
  };

  /** local driver: one multipart POST to the streaming route. */
  const uploadViaRoute = async (
    file: File,
    meta: { name: string; category: DocumentCategory }
  ) => {
    // Field order per the route contract: matterId before the file.
    const body = new FormData();
    if (scope.kind === "matter") body.append("matterId", scope.matterId);
    else body.append("leadId", scope.leadId);
    if (meta.name) body.append("name", meta.name);
    body.append("category", meta.category);
    body.append("files", file, file.name);
    const res = await fetch("/api/documents/upload", {
      method: "POST",
      body,
    });
    if (!res.ok) {
      let message = `Upload failed (HTTP ${res.status}).`;
      try {
        const json = (await res.json()) as { error?: string };
        if (json.error) message = json.error;
      } catch {
        /* non-JSON error body - keep the status message */
      }
      throw new Error(message);
    }
  };

  /** vercel-blob driver: client-direct upload. */
  const uploadViaBlob = async (
    file: File,
    meta: { name: string; category: DocumentCategory }
  ) => {
    const key = makeStorageKey(file.name);
    await upload(key, file, {
      // Documents live in a PRIVATE store (ADR-018).
      access: "private",
      handleUploadUrl: "/api/documents/upload/blob",
      contentType: contentTypeForFilename(key),
      clientPayload: JSON.stringify({
        ...scopeWhere(scope),
        folderId: null,
        name: meta.name || file.name,
        category: meta.category,
      }),
      multipart: true,
    });
  };

  const submit = async (form: HTMLFormElement) => {
    if (pending) return;
    const fd = new FormData(form);
    const file = fileInputRef.current?.files?.[0];
    if (!file || file.size === 0) {
      setError("Pick a file to upload.");
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError(`File is too large (max ${MAX_MB} MB).`);
      return;
    }
    const meta = parseUploadMeta({
      name: fd.get("name"),
      category: fd.get("category"),
    });
    if (!meta) {
      setError("Invalid upload - check the fields.");
      return;
    }

    setError(null);
    setPending(true);
    try {
      if (storageDriver === "vercel-blob") {
        await uploadViaBlob(file, meta);
        // The Document row is created by Vercel's completion
        // callback, which races this refresh - refresh again shortly
        // after to catch it.
        refreshTimerRef.current = setTimeout(() => router.refresh(), 2000);
      } else {
        await uploadViaRoute(file, meta);
      }
      collapse();
      router.refresh();
    } catch (err) {
      setError(
        storageDriver === "vercel-blob"
          ? blobUploadErrorMessage(err)
          : err instanceof TypeError
            ? NETWORK_ERROR
            : err instanceof Error && err.message
              ? err.message
              : NETWORK_ERROR
      );
    } finally {
      setPending(false);
    }
  };

  if (!expanded) {
    return (
      <Button
        variant="outline"
        type="button"
        onClick={() => setExpanded(true)}
        className="gap-2 text-xs border-dashed"
      >
        <Plus size={13} />
        Upload document
      </Button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
      className="flex flex-col gap-3 p-4 rounded-md border border-line bg-paper-2/40"
    >
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={fileId}
          className="text-2xs font-medium text-ink-3"
        >
          File <span className="text-warn">*</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            id={fileId}
            ref={fileInputRef}
            type="file"
            name="file"
            required
            onChange={(e) => setFilename(e.target.files?.[0]?.name ?? null)}
            className={cn(
              "block w-full text-xs text-ink-3",
              "file:mr-3 file:py-1.5 file:px-3 file:rounded-md",
              "file:border-0 file:text-xs file:font-medium",
              "file:bg-brand-700 file:text-white file:cursor-pointer",
              "hover:file:bg-brand-900"
            )}
          />
        </div>
        <span className="text-3xs text-ink-4 leading-relaxed">
          Max {MAX_MB} MB. PDFs preview inline; everything else downloads.
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={nameId}
            className="text-2xs font-medium text-ink-3"
          >
            Display name (optional)
          </label>
          <input
            id={nameId}
            name="name"
            type="text"
            placeholder={filename ?? "Falls back to the file's name"}
            maxLength={200}
            className={inputClass()}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={categoryId}
            className="text-2xs font-medium text-ink-3"
          >
            Category
          </label>
          <NativeSelect
            className="w-full"
            id={categoryId}
            name="category"
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentCategory)}
          >
            {DOCUMENT_CATEGORIES.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {DOCUMENT_CATEGORY_LABEL[c]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn"
        >
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={collapse}
          disabled={pending}
          className="text-2xs text-ink-3 hover:text-ink-2 px-2 disabled:opacity-60"
        >
          Cancel
        </button>
        <Button
          size="sm"
          type="submit"
          disabled={pending}
        >
          <Upload size={12} />
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </form>
  );
}
