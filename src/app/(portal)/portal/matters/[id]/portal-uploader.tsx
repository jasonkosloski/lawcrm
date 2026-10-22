"use client";

/**
 * Client upload widget for the portal. Phone-first: one big button, a
 * per-file progress list, plain-language errors.
 *
 * Transport follows the server-supplied `storageDriver` (a client can't read
 * env): `vercel-blob` uploads each file straight to Blob through the token
 * route; `local` (dev) posts one multipart request to
 * /api/documents/upload/local. Every pick is one batch
 * (`batchId`), so several files can answer a request together.
 *
 * Never redirects from client code: when the batch is done the page is
 * reloaded so the server lists pick up the new files.
 */

import { useRef, useState } from "react";
import { Check, TriangleAlert, Upload, X } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { getPortalRequestStatus } from "@/app/actions/portal-requests";
import { MAX_FILES_PER_BATCH } from "@/app/api/documents/upload/upload-config";
import { checkPortalUpload } from "@/lib/portal/upload-policy";
import { makeStorageKey, type StorageDriver } from "@/lib/storage/storage-key";
import { blobUploadErrorMessage } from "@/components/matters/documents/upload-errors";

const CLOSED_MESSAGE = "This request was closed by the firm. Your file was still sent.";

type FileRow = { name: string; size: number; loaded: number };

const mib = (bytes: number) => `${Math.floor(bytes / (1024 * 1024))} MB`;

/** The local (dev) route is reached through the proxy, which buffers at
 *  most 10 MB of a request body and hands the route a truncated copy
 *  past that. Keep the whole multipart body under it (headroom for the
 *  part headers and fields). */
const LOCAL_BATCH_MAX_BYTES = 10 * 1024 * 1024 - 64 * 1024;

export function PortalUploader({
  matterId,
  requestId,
  storageDriver,
  label = "Upload files",
}: {
  matterId: string;
  /** Answer this document request with the files. */
  requestId?: string;
  storageDriver: StorageDriver;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<{ abort: () => void } | null>(null);
  const [rows, setRows] = useState<FileRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closedNotice, setClosedNotice] = useState(false);
  // Some files of a batch were saved before a later one failed.
  const [partialSent, setPartialSent] = useState(false);

  const busy = rows !== null && !closedNotice;

  const preflight = (files: File[]): string | null => {
    if (files.length > MAX_FILES_PER_BATCH) {
      return `Please send ${MAX_FILES_PER_BATCH} files or fewer at a time.`;
    }
    if (
      storageDriver === "local" &&
      files.reduce((sum, f) => sum + f.size, 0) > LOCAL_BATCH_MAX_BYTES
    ) {
      return "In development, uploads are limited to 10 MB per batch.";
    }
    for (const f of files) {
      const check = checkPortalUpload(f.name);
      if (!check.ok) return check.error;
      if (f.size === 0) return `"${f.name}" is empty.`;
      if (f.size > check.maxBytes) {
        return `"${f.name}" is too large (the limit is ${mib(check.maxBytes)}).`;
      }
    }
    return null;
  };

  const finish = (requestClosed: boolean, delayMs: number) => {
    if (requestClosed) {
      setClosedNotice(true);
      return;
    }
    // The blob completion webhook creates the document a beat after the
    // browser finishes; give it a moment before the page re-reads.
    setTimeout(() => window.location.reload(), delayMs);
  };

  const fail = (message: string) => {
    abortRef.current = null;
    setRows(null);
    setError(message);
    if (inputRef.current) inputRef.current.value = "";
  };

  const setLoaded = (i: number, loaded: number) =>
    setRows((prev) => (prev ? prev.map((r, j) => (j === i ? { ...r, loaded } : r)) : prev));

  const sendBlob = async (files: File[], batchId: string) => {
    const controller = new AbortController();
    abortRef.current = { abort: () => controller.abort() };
    let sent = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const key = makeStorageKey(f.name);
        const check = checkPortalUpload(f.name);
        if (!check.ok) throw new Error(check.error);
        await upload(key, f, {
          access: "private",
          handleUploadUrl: "/api/documents/upload/blob",
          contentType: check.contentType,
          clientPayload: JSON.stringify({
            matterId,
            ...(requestId ? { requestId } : {}),
            batchId,
            name: f.name,
          }),
          multipart: true,
          abortSignal: controller.signal,
          onUploadProgress: ({ loaded }) => setLoaded(i, loaded),
        });
        setLoaded(i, f.size);
        sent++;
      }
    } catch (err) {
      if (controller.signal.aborted) {
        abortRef.current = null;
        setRows(null);
        return;
      }
      fail(blobUploadErrorMessage(err));
      if (sent > 0) setPartialSent(true);
      return;
    }
    abortRef.current = null;
    let closed = false;
    if (requestId) {
      try {
        const s = await getPortalRequestStatus(requestId);
        closed = s?.status === "cancelled" || s?.status === "complete";
      } catch {
        closed = false;
      }
    }
    finish(closed, 1500);
  };

  const sendLocal = (files: File[], batchId: string) => {
    const fd = new FormData();
    fd.append("matterId", matterId);
    fd.append("batchId", batchId);
    if (requestId) fd.append("requestId", requestId);
    for (const f of files) fd.append("files", f, f.name);

    const total = files.reduce((n, f) => n + f.size, 0);
    const xhr = new XMLHttpRequest();
    abortRef.current = xhr;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || e.total === 0) return;
      const sent = (e.loaded / e.total) * total;
      let acc = 0;
      setRows(
        files.map((f) => {
          const loaded = Math.min(f.size, Math.max(0, sent - acc));
          acc += f.size;
          return { name: f.name, size: f.size, loaded };
        }),
      );
    };
    xhr.onload = () => {
      abortRef.current = null;
      let body: {
        error?: string;
        documents?: { requestClosed?: boolean }[];
      } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON body */
      }
      if (xhr.status === 200) {
        finish(!!body.documents?.some((d) => d.requestClosed), 0);
      } else {
        fail(body.error ?? "We couldn't send your files. Please try again.");
      }
    };
    xhr.onerror = () => {
      abortRef.current = null;
      fail("We couldn't send your files. Check your connection and try again.");
    };
    xhr.onabort = () => {
      abortRef.current = null;
      setRows(null);
    };
    xhr.open("POST", "/api/documents/upload/local");
    xhr.send(fd);
  };

  const start = (files: File[]) => {
    setError(null);
    setPartialSent(false);
    const problem = preflight(files);
    if (problem) {
      setError(problem);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setRows(files.map((f) => ({ name: f.name, size: f.size, loaded: 0 })));
    const batchId = crypto.randomUUID();
    if (storageDriver === "vercel-blob") void sendBlob(files, batchId);
    else sendLocal(files, batchId);
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        aria-label={label}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) start(files);
        }}
      />
      {!busy && !closedNotice ? (
        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="h-10 self-start px-4 text-sm"
        >
          <Upload aria-hidden="true" />
          {label}
        </Button>
      ) : null}

      {rows ? (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {rows.map((r, i) => {
            const pct = r.size > 0 ? Math.round((r.loaded / r.size) * 100) : 0;
            return (
              <li key={i} className="flex flex-col gap-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-ink-2">{r.name}</span>
                  {pct >= 100 ? (
                    <Check className="size-4 text-ok" aria-label="Sent" />
                  ) : (
                    <span className="text-xs text-ink-3">{pct}%</span>
                  )}
                </div>
                <div
                  role="progressbar"
                  aria-label={`Sending ${r.name}`}
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 overflow-hidden rounded-full bg-paper-2"
                >
                  <div
                    className="h-full bg-brand-500 transition-[width] duration-200"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {busy ? (
        <Button
          type="button"
          variant="outline"
          className="h-10 self-start px-4 text-sm"
          onClick={() => abortRef.current?.abort()}
        >
          <X aria-hidden="true" />
          Cancel
        </Button>
      ) : null}

      {closedNotice ? (
        <div className="flex flex-col items-start gap-3">
          <p className="rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm text-ink-2">
            {CLOSED_MESSAGE}
          </p>
          <Button
            type="button"
            className="h-10 px-4 text-sm"
            onClick={() => window.location.reload()}
          >
            Done
          </Button>
        </div>
      ) : null}

      {partialSent ? (
        <Button
          type="button"
          variant="outline"
          className="h-10 self-start px-4 text-sm"
          onClick={() => window.location.reload()}
        >
          Done
        </Button>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-warn-border bg-warn-soft px-3 py-2 text-sm text-warn"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
