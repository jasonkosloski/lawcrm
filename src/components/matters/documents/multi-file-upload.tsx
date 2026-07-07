/**
 * Multi-file upload — "Upload files" toolbar button on the document
 * browser. Uploads INTO the currently browsed folder.
 *
 * Posts to POST /api/documents/upload (the streaming busboy route —
 * server actions can't take GB-scale bodies). Contract requirements
 * honored here:
 *
 *   - FIELD ORDER MATTERS: `matterId` (and optional `folderId`) are
 *     appended to the FormData BEFORE any `files` part — the route
 *     validates the target before the first file byte hits disk.
 *   - One or more file parts under the field name `files`.
 *   - 200 → { documents: [{ id, name }] }; 4xx/413 → { error }.
 *   - Batches are all-or-nothing; MIME is server-derived from the
 *     extension (the picker's `accept` is a convenience filter only).
 *
 * XMLHttpRequest, not fetch: fetch can't report UPLOAD progress
 * (Response streams cover download only) — xhr.upload.onprogress is
 * the only way to drive a real progress bar for multi-GB media.
 * Progress is per-batch (bytes sent / total). On success we
 * router.refresh() — the route's revalidatePath alone doesn't
 * re-render an already-mounted client view.
 *
 * Size caps are pre-checked client-side with the SAME constants the
 * route enforces (100 MiB standard / ~2 GiB media, by server-derived
 * type) so a doomed 4 GB upload fails instantly instead of at 100%.
 */

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MAX_FILES_PER_BATCH,
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_STANDARD_UPLOAD_BYTES,
  contentTypeForFilename,
  isMediaType,
} from "@/app/api/documents/upload/upload-config";

/** Picker filter: pdf / word / excel (+ppt, text) / images / audio /
 *  video. The server derives the real MIME from the extension and
 *  unknown types still store fine — this only trims the file dialog. */
const ACCEPT = [
  ".pdf",
  ".doc",
  ".docx",
  ".rtf",
  ".odt",
  ".xls",
  ".xlsx",
  ".csv",
  ".ppt",
  ".pptx",
  ".txt",
  ".md",
  ".log",
  "image/*",
  "audio/*",
  "video/*",
].join(",");

const formatMiB = (bytes: number): string =>
  `${Math.floor(bytes / (1024 * 1024))} MiB`;

export function MultiFileUpload({
  matterId,
  folderId,
  folderName,
}: {
  matterId: string;
  /** Upload destination — the currently browsed folder (null = root). */
  folderId: string | null;
  /** Display name for the button tooltip. */
  folderName: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileCount, setFileCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setUploading(false);
    setProgress(0);
    setFileCount(0);
    if (inputRef.current) inputRef.current.value = "";
  };

  /** Client-side mirror of the route's guards — instant feedback for
   *  the obvious rejections; the server remains the authority. */
  const preflightError = (files: File[]): string | null => {
    if (files.length > MAX_FILES_PER_BATCH) {
      return `Too many files (max ${MAX_FILES_PER_BATCH} per upload).`;
    }
    for (const f of files) {
      if (f.size === 0) return `"${f.name}" is empty.`;
      const type = contentTypeForFilename(f.name);
      const cap = isMediaType(type)
        ? MAX_MEDIA_UPLOAD_BYTES
        : MAX_STANDARD_UPLOAD_BYTES;
      if (f.size > cap) {
        return `"${f.name}" is too large (max ${formatMiB(cap)} for ${
          isMediaType(type) ? "media" : "this file type"
        }).`;
      }
    }
    return null;
  };

  const startUpload = (files: File[]) => {
    setError(null);
    const rejected = preflightError(files);
    if (rejected) {
      setError(rejected);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    // Field order per the route contract: target BEFORE file parts.
    const fd = new FormData();
    fd.append("matterId", matterId);
    if (folderId) fd.append("folderId", folderId);
    for (const f of files) fd.append("files", f, f.name);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    setUploading(true);
    setFileCount(files.length);
    setProgress(0);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status === 200) {
        reset();
        router.refresh();
      } else {
        let message = `Upload failed (HTTP ${xhr.status}).`;
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          /* non-JSON error body — keep the status message */
        }
        reset();
        setError(message);
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      reset();
      setError("Upload failed — check your connection and try again.");
    };
    xhr.onabort = () => {
      xhrRef.current = null;
      reset();
    };

    xhr.open("POST", "/api/documents/upload");
    xhr.send(fd);
  };

  if (uploading) {
    return (
      <div className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-line bg-white text-xs text-ink-3">
        <span className="whitespace-nowrap">
          Uploading {fileCount} file{fileCount === 1 ? "" : "s"}…
        </span>
        <div
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          className="w-24 h-1.5 rounded-full bg-paper-2 overflow-hidden"
        >
          <div
            className="h-full bg-brand-500 transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="font-mono text-2xs text-ink-4 w-8 text-right">
          {progress}%
        </span>
        <button
          type="button"
          onClick={() => xhrRef.current?.abort()}
          aria-label="Cancel upload"
          className="text-ink-4 hover:text-ink-2"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) startUpload(files);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title={`Upload into ${folderName ?? "All documents"}`}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
          "bg-brand-500 text-white hover:bg-brand-600 transition-colors"
        )}
      >
        <Upload size={13} />
        Upload files
      </button>
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn max-w-xs">
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
