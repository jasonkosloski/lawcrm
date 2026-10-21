/**
 * Send attachments field — the composers' "Attach" control.
 *
 * Attachments are documents filed to the email's matter or lead
 * (ADR-034: the send action gets document ids, never bytes). The
 * popover searches that record's documents; "Upload new…" files a
 * new document to the record first (category correspondence) through
 * the same transports as the Documents tab, then attaches it:
 *
 *   - local       → POST /api/documents/upload, which returns the row
 *   - vercel-blob → client-direct upload; the Document row is written
 *                   by Vercel's completion callback, so we poll for
 *                   it by its blob URL
 *
 * Without a record the button is disabled - there is nothing to pick
 * from yet. The host clears the list when the record changes.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Search, Upload, X } from "lucide-react";
import { upload } from "@vercel/blob/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { scopeWhere, type RecordScope } from "@/lib/record-scope";
import { formatFileSize } from "@/lib/document-display";
import { MAX_DOCUMENT_BYTES } from "@/lib/document-form";
import { contentTypeForFilename } from "@/app/api/documents/upload/upload-config";
import { makeStorageKey, type StorageDriver } from "@/lib/storage/storage-key";
import {
  MAX_SEND_ATTACHMENTS,
  MAX_SEND_ATTACHMENT_BYTES,
} from "@/lib/email-send-status";
import {
  findUploadedDocument,
  listAttachableDocuments,
  type AttachableDocument,
} from "@/app/actions/email-send-attachments";
import { blobUploadErrorMessage } from "@/components/matters/documents/upload-errors";

const MAX_TOTAL_MB = Math.round(MAX_SEND_ATTACHMENT_BYTES / (1024 * 1024));

/** How long to wait for the blob completion callback's Document row. */
const BLOB_POLL_ATTEMPTS = 15;
const BLOB_POLL_MS = 1000;

export function SendAttachmentsField({
  scope,
  value,
  onChange,
  disabled = false,
  canUpload,
  storageDriver,
  onBusyChange,
}: {
  scope: RecordScope | null;
  value: AttachableDocument[];
  onChange: (next: AttachableDocument[]) => void;
  disabled?: boolean;
  /** `documents.upload` - shows "Upload new…". */
  canUpload: boolean;
  storageDriver?: StorageDriver;
  /** True while an upload runs: the host holds Send and the record
   *  picker so the draft can't move underneath it. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<AttachableDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scopeKey = scope ? JSON.stringify(scope) : "";
  // An upload outlives the render that started it: read the latest
  // list and record when it finishes, not the ones it closed over.
  const valueRef = useRef(value);
  const scopeKeyRef = useRef(scopeKey);
  useEffect(() => {
    valueRef.current = value;
    scopeKeyRef.current = scopeKey;
  });

  // Search the record's documents while the popover is open.
  useEffect(() => {
    if (!open || !scope) return;
    let cancelled = false;
    const t = setTimeout(() => {
      listAttachableDocuments(scope, query)
        .then((rows) => {
          if (!cancelled) setDocs(rows);
        })
        .catch(() => {
          if (!cancelled) setError("Couldn't load documents.");
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // scopeKey stands in for scope (a fresh object each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeKey, query]);

  const totalBytes = value.reduce((n, d) => n + (d.fileSize ?? 0), 0);
  const full = value.length >= MAX_SEND_ATTACHMENTS;

  const add = (doc: AttachableDocument): boolean => {
    const current = valueRef.current;
    if (current.some((d) => d.id === doc.id)) return true;
    if (current.length >= MAX_SEND_ATTACHMENTS) {
      setError(`At most ${MAX_SEND_ATTACHMENTS} attachments.`);
      return false;
    }
    const used = current.reduce((n, d) => n + (d.fileSize ?? 0), 0);
    if (used + (doc.fileSize ?? 0) > MAX_SEND_ATTACHMENT_BYTES) {
      setError(`Attachments can total at most ${MAX_TOTAL_MB} MB.`);
      return false;
    }
    setError(null);
    onChange([...current, doc]);
    return true;
  };

  const remove = (id: string) => onChange(value.filter((d) => d.id !== id));

  const uploadNew = async (file: File) => {
    if (!scope) return;
    if (file.size === 0) {
      setError("That file is empty.");
      return;
    }
    // Check against what's left of the send budget BEFORE uploading,
    // so a file that can't be attached is never filed to the record.
    const room = MAX_SEND_ATTACHMENT_BYTES - totalBytes;
    if (file.size > Math.min(MAX_DOCUMENT_BYTES, room)) {
      setError(
        room < MAX_DOCUMENT_BYTES
          ? `Not enough room: ${formatFileSize(Math.max(room, 0))} left of the ${MAX_TOTAL_MB} MB attachment limit.`
          : `File is too large (max ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB).`
      );
      return;
    }
    const startedFor = scopeKey;
    setError(null);
    setUploading(true);
    onBusyChange?.(true);
    try {
      let doc: AttachableDocument | null = null;
      if (storageDriver === "vercel-blob") {
        const key = makeStorageKey(file.name);
        const blob = await upload(key, file, {
          access: "private",
          handleUploadUrl: "/api/documents/upload/blob",
          contentType: contentTypeForFilename(key),
          clientPayload: JSON.stringify({
            ...scopeWhere(scope),
            folderId: null,
            name: file.name,
            category: "correspondence",
          }),
          multipart: true,
        });
        for (let i = 0; i < BLOB_POLL_ATTEMPTS && !doc; i++) {
          await new Promise((r) => setTimeout(r, BLOB_POLL_MS));
          doc = await findUploadedDocument(scope, blob.url);
        }
        if (!doc) {
          setError(
            "Uploaded, but the document isn't ready yet. Try attaching it from the list in a moment."
          );
          return;
        }
      } else {
        const body = new FormData();
        if (scope.kind === "matter") body.append("matterId", scope.matterId);
        else body.append("leadId", scope.leadId);
        body.append("category", "correspondence");
        body.append("files", file, file.name);
        const res = await fetch("/api/documents/upload", {
          method: "POST",
          body,
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          documents?: { id: string; name: string }[];
        };
        if (!res.ok || !json.documents?.[0]) {
          setError(json.error ?? `Upload failed (HTTP ${res.status}).`);
          return;
        }
        doc = { ...json.documents[0], fileSize: file.size };
      }
      // The record changed (or the draft was sent) meanwhile: the file
      // is filed to the record, but this draft no longer wants it.
      if (scopeKeyRef.current !== startedFor) return;
      if (add(doc)) setOpen(false);
    } catch (err) {
      setError(
        storageDriver === "vercel-blob"
          ? blobUploadErrorMessage(err)
          : "Upload failed - check your connection and try again."
      );
    } finally {
      setUploading(false);
      onBusyChange?.(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const busy = disabled || uploading;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((d) => (
          <span
            key={d.id}
            data-testid="send-attachment"
            className="inline-flex items-center gap-1 max-w-full h-6 pl-2 pr-1 rounded-md border border-line bg-paper-2 text-2xs text-ink"
          >
            <Paperclip size={10} className="text-ink-4 shrink-0" />
            <span className="truncate max-w-48">{d.name}</span>
            {d.fileSize != null && (
              <span className="font-mono text-ink-4 shrink-0">
                {formatFileSize(d.fileSize)}
              </span>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => remove(d.id)}
              aria-label={`Remove ${d.name}`}
              className="inline-flex items-center justify-center w-4 h-4 rounded text-ink-4 hover:text-ink-2 disabled:opacity-50"
            >
              <X size={10} />
            </button>
          </span>
        ))}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={busy || !scope || full}
                title={scope ? undefined : "Choose a matter or lead first"}
                className="gap-1 text-ink-3"
              >
                <Paperclip size={11} />
                {uploading ? "Uploading…" : "Attach"}
              </Button>
            }
          />
          <PopoverContent align="start" className="w-80">
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Search
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-4"
                />
                <input
                  type="text"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search this record's documents…"
                  aria-label="Search documents"
                  className="h-8 w-full pl-7 pr-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
                />
              </div>
              <ul className="flex flex-col gap-px max-h-64 overflow-y-auto">
                {docs === null && (
                  <li className="text-2xs text-ink-4 px-2 py-1.5">Loading…</li>
                )}
                {docs?.length === 0 && (
                  <li className="text-2xs text-ink-4 italic px-2 py-1.5">
                    No documents match.
                  </li>
                )}
                {docs?.map((d) => {
                  const attached = value.some((v) => v.id === d.id);
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        disabled={attached}
                        onClick={() => {
                          if (add(d)) setOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left transition-colors",
                          attached
                            ? "text-ink-4 cursor-default"
                            : "text-ink hover:bg-paper-2"
                        )}
                      >
                        <span className="flex-1 truncate">{d.name}</span>
                        <span className="text-2xs font-mono text-ink-4 shrink-0">
                          {attached ? "Attached" : formatFileSize(d.fileSize)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {canUpload && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploading}
                    className="gap-1.5"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={12} />
                    Upload new…
                  </Button>
                  <p className="text-2xs text-ink-4">
                    Uploads are filed to this record&apos;s documents as
                    correspondence.
                  </p>
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {/* Outside the popover: opening the OS file dialog can close the
          popover, which must not unmount the input before it fires. */}
      {canUpload && (
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          aria-label="Upload a new document"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadNew(file);
          }}
        />
      )}
      {error && <div className="text-2xs text-warn">{error}</div>}
    </div>
  );
}
