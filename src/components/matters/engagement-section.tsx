/**
 * Engagement section of /matters/new: the matter's originating document
 * (fee agreement / retainer; the practice area names it). Status, signed
 * date, and the draft's files with a "this is the {label}" mark.
 *
 * Files live on the DRAFT (they are not Documents until Create re-homes
 * them), so attaching with no draft yet first asks the form to create
 * one. Posts the hidden `draftId` / `draftUpdatedAt` / `originatingFileId`
 * Create needs; the status and date are real inputs.
 */

"use client";

import { useState } from "react";
import { Paperclip, X } from "lucide-react";
import { MultiFileUpload } from "@/components/matters/documents/multi-file-upload";
import {
  removeDraftFile,
  setDraftFileOriginating,
} from "@/app/actions/matter-drafts";
import type { StorageDriver } from "@/lib/storage/storage-key";
import { AgreementFields } from "./agreement-fields";
import { Section } from "./form-primitives";

export type EngagementFile = { id: string; name: string; isOriginating: boolean };

export type EngagementChange = {
  status?: string;
  signedDate?: string;
  originatingFileId?: string;
  /** A file was removed from the draft. */
  removedFileId?: string;
};

export function EngagementSection({
  label,
  required,
  canUpload,
  draftId,
  draftUpdatedAt,
  ensureDraft,
  files,
  status,
  signedDate,
  originatingFileId,
  onChange,
  errors,
  storageDriver,
}: {
  label: string;
  required: boolean;
  canUpload: boolean;
  draftId: string | null;
  draftUpdatedAt: string | null;
  ensureDraft: () => Promise<string>;
  files: EngagementFile[];
  status: string;
  signedDate: string;
  originatingFileId: string;
  onChange: (change: EngagementChange) => void;
  errors?: Record<string, string[] | undefined>;
  storageDriver?: StorageDriver;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const err = (k: string) => errors?.[k]?.[0];

  const mark = async (fileId: string) => {
    setFileError(null);
    const res = await setDraftFileOriginating(fileId);
    if (res.ok) onChange({ originatingFileId: fileId });
    else setFileError("Couldn't mark that file. Try again.");
  };
  const remove = async (fileId: string) => {
    setFileError(null);
    const res = await removeDraftFile(fileId);
    if (res.ok) onChange({ removedFileId: fileId });
    else setFileError("Couldn't remove that file. Try again.");
  };

  return (
    <Section title={label}>
      <input type="hidden" name="draftId" value={draftId ?? ""} />
      <input type="hidden" name="draftUpdatedAt" value={draftUpdatedAt ?? ""} />
      <input type="hidden" name="originatingFileId" value={originatingFileId} />

      <AgreementFields
        required={required}
        status={status}
        signedDate={signedDate}
        onStatusChange={(v) => onChange({ status: v })}
        onSignedDateChange={(v) => onChange({ signedDate: v })}
        errors={errors}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-2">
            Files
            {required && <span className="text-warn ml-0.5">*</span>}
          </span>
          {canUpload && (
            <MultiFileUpload
              scope={{ kind: "draft", draftId, ensureDraft }}
              folderId={null}
              folderName="the draft"
              storageDriver={storageDriver}
            />
          )}
        </div>

        {!canUpload && (
          <div className="text-2xs text-ink-4">
            You need permission to upload documents to attach the {label}.
          </div>
        )}

        {files.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {files.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-2"
              >
                <Paperclip size={12} className="text-ink-4 shrink-0" />
                <span className="truncate flex-1">{f.name}</span>
                <label className="flex items-center gap-1.5 text-2xs text-ink-3 cursor-pointer whitespace-nowrap">
                  <input
                    type="radio"
                    name="originatingFileMark"
                    checked={originatingFileId === f.id}
                    onChange={() => void mark(f.id)}
                  />
                  This is the {label}
                </label>
                <button
                  type="button"
                  onClick={() => void remove(f.id)}
                  aria-label={`Remove ${f.name}`}
                  className="p-0.5 rounded text-ink-3 hover:text-ink-2"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {err("originatingFileId") && (
          <div className="text-2xs text-warn">{err("originatingFileId")}</div>
        )}
        {fileError && <div className="text-2xs text-warn">{fileError}</div>}
      </div>
    </Section>
  );
}
