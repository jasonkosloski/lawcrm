/**
 * Attachment chips — per-message attachment row in the email thread
 * reader (extracted from thread-reader.tsx when the chips grew
 * actions; Email v1.1).
 *
 * Per attachment:
 *   - Download — GET /api/email-attachments/[id]/download (first hit
 *     fetches the bytes from Gmail and caches them; `download` attr
 *     forces save-as even for inline-safe types).
 *   - View — same route in a new tab, offered ONLY for types on the
 *     shared inline allowlist (`src/lib/inline-safe-types.ts`);
 *     anything else would be served `attachment` anyway, so the
 *     affordance would lie.
 *   - File to matter… — dialog (matter picker defaulting to the
 *     thread's filing + folder picker fetched per matter via
 *     `listMatterFolders`) calling `fileAttachmentToMatter`. Gated
 *     on the `documents.upload` read-side flag threaded in from the
 *     server component (`canFile`).
 *
 * Re-filing the same attachment to the same matter no-ops server-
 * side (`alreadyFiled`) — the dialog surfaces that as an info note
 * instead of pretending a duplicate was created.
 */

"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Briefcase,
  Check,
  Download,
  Eye,
  FolderInput,
  Info,
  Paperclip,
  Pin,
  Search,
  TriangleAlert,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { isInlineSafeType } from "@/lib/inline-safe-types";
import {
  fileAttachmentToMatter,
  listMatterFolders,
} from "@/app/actions/email-attachments";
import type { FilingMatterOption } from "@/lib/queries/communication";
import type { FlatFolder } from "@/lib/folder-tree";

export type AttachmentChipItem = {
  id: string;
  filename: string;
  contentType: string | null;
  fileSize: number | null;
};

const formatSize = (bytes: number | null): string => {
  if (bytes === null || bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const downloadUrl = (id: string): string =>
  `/api/email-attachments/${id}/download`;

export function AttachmentChips({
  attachments,
  /** documents.upload read-side flag — hides the filing affordance. */
  canFile,
  /** The thread's current filing — the dialog's default matter. */
  defaultMatter,
  /** Open-matter list (pinned first) — same data the thread header's
   *  file-to-matter picker uses. */
  matterOptions,
}: {
  attachments: AttachmentChipItem[];
  canFile: boolean;
  defaultMatter: { id: string; name: string } | null;
  matterOptions: FilingMatterOption[];
}) {
  const [filing, setFiling] = useState<AttachmentChipItem | null>(null);

  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3 border-t border-line bg-paper-2/40">
      {attachments.map((a) => {
        const viewable = isInlineSafeType(a.contentType);
        return (
          <div
            key={a.id}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-line bg-white text-2xs text-ink-2 max-w-full"
            title={`${a.filename} — ${formatSize(a.fileSize)}`}
          >
            <Paperclip size={11} className="text-ink-4 shrink-0" />
            <span className="font-medium truncate max-w-48">{a.filename}</span>
            <span className="font-mono text-ink-4 shrink-0">
              {formatSize(a.fileSize)}
            </span>
            <span className="flex items-center gap-0.5 shrink-0 pl-1 ml-0.5 border-l border-line">
              {viewable && (
                <a
                  href={downloadUrl(a.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View"
                  aria-label={`View ${a.filename}`}
                  className="p-1 rounded text-ink-4 hover:text-brand-700 hover:bg-paper-2"
                >
                  <Eye size={12} />
                </a>
              )}
              <a
                href={downloadUrl(a.id)}
                download={a.filename}
                title="Download"
                aria-label={`Download ${a.filename}`}
                className="p-1 rounded text-ink-4 hover:text-brand-700 hover:bg-paper-2"
              >
                <Download size={12} />
              </a>
              {canFile && (
                <button
                  type="button"
                  onClick={() => setFiling(a)}
                  title="File to matter…"
                  aria-label={`File ${a.filename} to matter`}
                  className="p-1 rounded text-ink-4 hover:text-brand-700 hover:bg-paper-2"
                >
                  <FolderInput size={12} />
                </button>
              )}
            </span>
          </div>
        );
      })}

      {canFile && (
        <FileAttachmentDialog
          attachment={filing}
          onClose={() => setFiling(null)}
          defaultMatter={defaultMatter}
          matterOptions={matterOptions}
        />
      )}
    </div>
  );
}

/**
 * "File to matter…" dialog. Matter list (search-filterable, pinned
 * first — same client-side filter idiom as FileToMatterPicker) +
 * a folder select fetched per chosen matter.
 */
function FileAttachmentDialog({
  attachment,
  onClose,
  defaultMatter,
  matterOptions,
}: {
  attachment: AttachmentChipItem | null;
  onClose: () => void;
  defaultMatter: { id: string; name: string } | null;
  matterOptions: FilingMatterOption[];
}) {
  const [matterId, setMatterId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FlatFolder[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset per open (render-phase reset — MoveToFolderDialog pattern),
  // defaulting the matter to the thread's filing.
  const open = attachment !== null;
  const [prevAttachmentId, setPrevAttachmentId] = useState<string | null>(
    null
  );
  if ((attachment?.id ?? null) !== prevAttachmentId) {
    setPrevAttachmentId(attachment?.id ?? null);
    if (attachment) {
      setMatterId(defaultMatter?.id ?? null);
      setFolderId(null);
      setFolders([]);
      setQuery("");
      setError(null);
      setNotice(null);
    }
  }

  // Folder list follows the chosen matter (the pick handler + the
  // per-open reset clear the stale list synchronously; this effect
  // only syncs with the server). Stale responses (user re-picks
  // before the fetch lands) are dropped via the cleanup flag.
  useEffect(() => {
    if (!open || !matterId) return;
    let cancelled = false;
    listMatterFolders(matterId)
      .then((rows) => {
        if (!cancelled) setFolders(rows);
      })
      .catch(() => {
        if (!cancelled) setFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, matterId]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? matterOptions.filter(
        (m) =>
          m.name.toLowerCase().includes(q) || m.area.toLowerCase().includes(q)
      )
    : matterOptions;

  const submit = () => {
    if (!attachment || !matterId) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fileAttachmentToMatter(
        attachment.id,
        matterId,
        folderId
      );
      if (!res.ok) {
        setError(res.error ?? "Couldn't file the attachment — try again.");
      } else if (res.alreadyFiled) {
        setNotice(
          "Already filed to this matter — nothing was duplicated."
        );
      } else {
        onClose();
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>File attachment to matter</DialogTitle>
          <DialogDescription>
            {attachment
              ? `Save “${attachment.filename}” into a matter's documents.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {/* Matter picker */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 h-8 px-2 rounded-md border border-line bg-white">
            <Search size={12} className="text-ink-4 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search matters…"
              className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-ink-4"
            />
          </div>
          <div className="flex flex-col gap-0.5 max-h-44 overflow-y-auto rounded-md border border-line bg-white p-1.5">
            {filtered.length === 0 && (
              <div className="px-2 py-2 text-2xs text-ink-4">
                No open matters match.
              </div>
            )}
            {filtered.map((m) => {
              const picked = m.id === matterId;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setMatterId(m.id);
                    setFolderId(null);
                    setFolders([]);
                    setNotice(null);
                  }}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left text-xs",
                    picked
                      ? "bg-brand-soft text-brand-700 font-medium"
                      : "text-ink-2 hover:bg-paper-2"
                  )}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: m.color }}
                  />
                  <span className="truncate">{m.name}</span>
                  <span className="text-2xs text-ink-4 truncate">
                    {m.area}
                  </span>
                  <span className="ml-auto shrink-0 flex items-center gap-1">
                    {m.isPinned && <Pin size={10} className="text-ink-4" />}
                    {picked && <Check size={12} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Folder picker — root + flattened tree, indented by depth. */}
        {matterId && (
          <label className="flex flex-col gap-1 text-2xs text-ink-3">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Briefcase size={11} className="text-ink-4" />
              Folder
            </span>
            <select
              value={folderId ?? ""}
              disabled={pending}
              onChange={(e) => setFolderId(e.target.value || null)}
              className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink-2 outline-none"
            >
              <option value="">All documents (matter root)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {/* NBSP indent — plain spaces collapse inside <option>. */}
                  {`${"  ".repeat(f.depth - 1)}${f.name}`}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
            <TriangleAlert size={12} className="shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-paper-2 border border-line text-2xs text-ink-3">
            <Info size={12} className="shrink-0 mt-px" />
            <span>{notice}</span>
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="text-2xs text-ink-3 hover:text-ink-2 px-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !matterId}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
              "bg-brand-500 text-white hover:bg-brand-600 transition-colors",
              "disabled:opacity-60 disabled:cursor-not-allowed"
            )}
          >
            <FolderInput size={12} />
            {pending ? "Filing…" : "File to matter"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
