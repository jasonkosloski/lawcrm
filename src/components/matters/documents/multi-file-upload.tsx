/**
 * Multi-file upload — "Upload files" toolbar button on the document
 * browser. Uploads INTO the currently browsed folder.
 *
 * TWO TRANSPORT PATHS, picked by the `storageDriver` prop (the
 * documents-tab server component reads `activeStorageDriver()` and
 * passes it down — a client component can't read env vars). The
 * visible UX — button, batch progress bar, cancel, error strip — is
 * identical either way.
 *
 * ── local (dev default) ─────────────────────────────────────────
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
 *
 * ── vercel-blob (production) ────────────────────────────────────
 * `upload()` from @vercel/blob/client, one call per file: browser →
 * token route (/api/documents/upload/blob, which gates + validates)
 * → bytes go STRAIGHT to Vercel Blob (multipart, so GB media clears
 * the ~4.5MB serverless body cap) → Vercel calls the token route
 * back to create the Document row. Files upload sequentially;
 * progress aggregates loaded bytes across the batch so the bar
 * reads the same as the XHR path. Two honest divergences from the
 * local contract, both server-enforced per-file rather than
 * per-batch: (1) batches are NOT all-or-nothing — files completed
 * before a failure stay uploaded (each is its own transfer);
 * (2) the Document row is created by an async callback, so a
 * just-finished file can lag the first refresh by a beat — we
 * refresh again shortly after to catch it.
 *
 * Size caps are pre-checked client-side with the SAME constants the
 * server enforces (100 MiB standard / ~2 GiB media, by server-derived
 * type) so a doomed 4 GB upload fails instantly instead of at 100%.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert, Upload, X } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { cn } from "@/lib/utils";
import {
  MAX_FILES_PER_BATCH,
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_STANDARD_UPLOAD_BYTES,
  contentTypeForFilename,
  isMediaType,
} from "@/app/api/documents/upload/upload-config";
import {
  makeStorageKey,
  type StorageDriver,
} from "@/lib/storage/storage-key";

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
  storageDriver,
}: {
  matterId: string;
  /** Upload destination — the currently browsed folder (null = root). */
  folderId: string | null;
  /** Display name for the button tooltip. */
  folderName: string | null;
  /** Which transport to use — from `activeStorageDriver()` on the
   *  server. Defaults to local so nothing breaks if a callsite
   *  hasn't been plumbed yet. */
  storageDriver?: StorageDriver;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  /** Whatever can cancel the in-flight batch — the XHR for the
   *  local path, an AbortController for the blob path. */
  const cancelRef = useRef<{ abort: () => void } | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileCount, setFileCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    []
  );

  const reset = () => {
    setUploading(false);
    setProgress(0);
    setFileCount(0);
    if (inputRef.current) inputRef.current.value = "";
  };

  /** Client-side mirror of the server's guards — instant feedback for
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

  /** local driver: one multipart POST to the streaming route. */
  const startXhrUpload = (files: File[]) => {
    // Field order per the route contract: target BEFORE file parts.
    const fd = new FormData();
    fd.append("matterId", matterId);
    if (folderId) fd.append("folderId", folderId);
    for (const f of files) fd.append("files", f, f.name);

    const xhr = new XMLHttpRequest();
    cancelRef.current = xhr;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      cancelRef.current = null;
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
      cancelRef.current = null;
      reset();
      setError("Upload failed — check your connection and try again.");
    };
    xhr.onabort = () => {
      cancelRef.current = null;
      reset();
    };

    xhr.open("POST", "/api/documents/upload");
    xhr.send(fd);
  };

  /** vercel-blob driver: client-direct upload per file. */
  const startBlobUpload = async (files: File[]) => {
    const controller = new AbortController();
    cancelRef.current = { abort: () => controller.abort() };

    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    const loadedPerFile = files.map(() => 0);
    const reportProgress = () => {
      const loaded = loadedPerFile.reduce((sum, n) => sum + n, 0);
      setProgress(
        totalBytes > 0 ? Math.round((loaded / totalBytes) * 100) : 0
      );
    };

    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        // The browser names the blob pathname using the SAME opaque
        // key scheme the server uses everywhere else; the token
        // route re-validates the shape. The declared contentType is
        // derived from the key with the same shared function the
        // route uses for allowedContentTypes — they can't disagree.
        const key = makeStorageKey(f.name);
        await upload(key, f, {
          access: "public",
          handleUploadUrl: "/api/documents/upload/blob",
          contentType: contentTypeForFilename(key),
          clientPayload: JSON.stringify({
            matterId,
            folderId,
            name: f.name,
          }),
          // Chunked-parallel transfer with per-part retries — the
          // sane mode for GB-scale media.
          multipart: true,
          abortSignal: controller.signal,
          onUploadProgress: ({ loaded }) => {
            loadedPerFile[i] = loaded;
            reportProgress();
          },
        });
        loadedPerFile[i] = f.size;
        reportProgress();
      }
      cancelRef.current = null;
      reset();
      // The Document rows are created by Vercel's completion
      // callback, which races this refresh. Refresh now (usually
      // wins) and once more shortly after (catches the stragglers).
      router.refresh();
      refreshTimerRef.current = setTimeout(() => router.refresh(), 2000);
    } catch (err) {
      cancelRef.current = null;
      reset();
      if (!controller.signal.aborted) {
        // Completed files stay uploaded (per-file transfers can't be
        // all-or-nothing); the second refresh shows what landed.
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Upload failed — check your connection and try again."
        );
        router.refresh();
      }
    }
  };

  const startUpload = (files: File[]) => {
    setError(null);
    const rejected = preflightError(files);
    if (rejected) {
      setError(rejected);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setUploading(true);
    setFileCount(files.length);
    setProgress(0);

    if (storageDriver === "vercel-blob") {
      void startBlobUpload(files);
    } else {
      startXhrUpload(files);
    }
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
          onClick={() => cancelRef.current?.abort()}
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
