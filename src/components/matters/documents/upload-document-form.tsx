/**
 * Upload Document Composer
 *
 * Inline single-file picker for the Documents tab, with a display
 * name override and a category (the multi-file "Upload files" button
 * has neither). Collapsed: one "Upload document" button. Expanded:
 * native file input + optional display name + category + submit; on
 * success the page refreshes and we collapse back.
 *
 * Transport is the same as the multi-file uploader's, picked by the
 * `storageDriver` prop (a client component can't read env vars):
 *
 *   - local: one multipart POST to /api/documents/upload (the
 *     streaming busboy route) with `matterId`, `category` and `name`
 *     fields BEFORE the file part, per the route contract.
 *   - vercel-blob: client-direct `upload()` to the private store via
 *     /api/documents/upload/blob; the display name and category ride
 *     in the signed `clientPayload`, and Vercel's completion callback
 *     creates the Document row.
 *
 * It must NOT be a server action: Next caps action bodies at 1 MB,
 * which silently broke every file over 1 MB.
 */

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, TriangleAlert, Upload } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { cn } from "@/lib/utils";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_STANDARD_UPLOAD_BYTES,
  contentTypeForFilename,
  isMediaType,
} from "@/app/api/documents/upload/upload-config";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABEL,
  type DocumentCategory,
} from "@/lib/document-form";
import {
  makeStorageKey,
  type StorageDriver,
} from "@/lib/storage/storage-key";

const formatMiB = (bytes: number): string =>
  `${Math.floor(bytes / (1024 * 1024))} MiB`;

/** Client-side mirror of the server's guards — instant feedback; the
 *  server stays the authority. Returns an error message or null. */
function preflightError(file: File): string | null {
  if (file.size === 0) return `"${file.name}" is empty.`;
  const type = contentTypeForFilename(file.name);
  const cap = isMediaType(type)
    ? MAX_MEDIA_UPLOAD_BYTES
    : MAX_STANDARD_UPLOAD_BYTES;
  if (file.size > cap) {
    return `"${file.name}" is too large (max ${formatMiB(cap)} for ${
      isMediaType(type) ? "media" : "this file type"
    }).`;
  }
  return null;
}

export function UploadDocumentForm({
  matterId,
  storageDriver,
}: {
  matterId: string;
  /** Which transport to use — from `activeStorageDriver()` on the
   *  server. Defaults to local, like MultiFileUpload. */
  storageDriver?: StorageDriver;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [category, setCategory] = useState<DocumentCategory>("other");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const collapse = () => {
    setExpanded(false);
    setError(null);
    setFilename(null);
    setCategory("other");
  };

  const uploadLocal = async (file: File, displayName: string) => {
    // Field order per the route contract: target BEFORE the file.
    const fd = new FormData();
    fd.append("matterId", matterId);
    fd.append("category", category);
    if (displayName) fd.append("name", displayName);
    fd.append("files", file, file.name);
    const res = await fetch("/api/documents/upload", {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      let message = `Upload failed (HTTP ${res.status}).`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* non-JSON error body — keep the status message */
      }
      throw new Error(message);
    }
  };

  const uploadBlob = async (file: File, displayName: string) => {
    const key = makeStorageKey(file.name);
    await upload(key, file, {
      access: "private",
      handleUploadUrl: "/api/documents/upload/blob",
      contentType: contentTypeForFilename(key),
      clientPayload: JSON.stringify({
        matterId,
        folderId: null,
        name: displayName || file.name,
        category,
      }),
      multipart: true,
    });
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Pick a file to upload.");
      return;
    }
    const rejected = preflightError(file);
    if (rejected) {
      setError(rejected);
      return;
    }
    const displayName = (nameInputRef.current?.value ?? "").trim();

    setPending(true);
    try {
      if (storageDriver === "vercel-blob") {
        await uploadBlob(file, displayName);
      } else {
        await uploadLocal(file, displayName);
      }
      collapse();
      router.refresh();
      // Blob rows are created by Vercel's async completion callback,
      // which races the first refresh — refresh again shortly after.
      if (storageDriver === "vercel-blob") {
        setTimeout(() => router.refresh(), 2000);
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Upload failed — check your connection and try again."
      );
    } finally {
      setPending(false);
    }
  };

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
      onSubmit={onSubmit}
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
          Max {formatMiB(MAX_STANDARD_UPLOAD_BYTES)} (audio and video up to{" "}
          {formatMiB(MAX_MEDIA_UPLOAD_BYTES)}). PDFs, images, audio/video,
          Word and text files preview in the viewer; other types download.
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Display name (optional)
          </label>
          <input
            ref={nameInputRef}
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

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={collapse}
          disabled={pending}
          className="text-2xs text-ink-3 hover:text-ink-2 px-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
            "bg-brand-500 text-white hover:bg-brand-600 transition-colors",
            "disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          <Upload size={12} />
          {pending ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  );
}
