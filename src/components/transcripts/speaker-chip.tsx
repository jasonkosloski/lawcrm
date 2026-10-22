/**
 * SpeakerChip — the speaker name on a paragraph. In edit mode it opens a
 * menu: Rename… (a dialog; renames the speaker everywhere) and "Change
 * speaker for this paragraph" (existing speakers, or a new one).
 */

"use client";

import { useState, useTransition } from "react";
import {
  renameTranscriptSpeaker,
  setSegmentSpeaker,
} from "@/app/actions/transcripts";
import { notifyError } from "@/lib/feedback";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Next unused single capital letter, or null when all 26 are taken. */
export function nextSpeakerLabel(speakers: Record<string, string>): string | null {
  for (let c = 65; c <= 90; c++) {
    const l = String.fromCharCode(c);
    if (!Object.hasOwn(speakers, l)) return l;
  }
  return null;
}

export function SpeakerChip({
  transcriptId,
  segmentId,
  revision,
  speaker,
  speakers,
}: {
  transcriptId: string;
  segmentId: string;
  revision: number;
  speaker: string;
  speakers: Record<string, string>;
}) {
  const name = speakers[speaker] ?? `Speaker ${speaker}`;
  const [renameOpen, setRenameOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const fresh = nextSpeakerLabel(speakers);

  const assign = (label: string) =>
    startTransition(async () => {
      try {
        const res = await setSegmentSpeaker(segmentId, label, revision);
        if (!res.ok) {
          notifyError(
            res.conflict
              ? "Someone else changed this paragraph. Reload to see their version."
              : res.error,
          );
        }
      } catch {
        notifyError("Couldn't change the speaker. Try again.");
      }
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`Speaker: ${name}`}
              disabled={pending}
              className="rounded px-1 font-semibold text-ink-2 underline decoration-dotted underline-offset-2 hover:text-brand-700 disabled:opacity-50"
            >
              {name}
            </button>
          }
        />
        <DropdownMenuContent className="min-w-52">
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>Rename…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Change speaker for this paragraph</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {Object.entries(speakers)
                .filter(([k]) => k !== speaker)
                .map(([k, n]) => (
                  <DropdownMenuItem key={k} onClick={() => assign(k)}>
                    {n}
                  </DropdownMenuItem>
                ))}
              {fresh && (
                <DropdownMenuItem onClick={() => assign(fresh)}>New speaker</DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
      {renameOpen && (
        <RenameDialog
          transcriptId={transcriptId}
          speaker={speaker}
          initialName={name}
          onClose={() => setRenameOpen(false)}
        />
      )}
    </>
  );
}

function RenameDialog({
  transcriptId,
  speaker,
  initialName,
  onClose,
}: {
  transcriptId: string;
  speaker: string;
  initialName: string;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await renameTranscriptSpeaker(transcriptId, speaker, value);
        if (res.ok) onClose();
        else setError(res.error ?? "Couldn't rename the speaker.");
      } catch {
        setError("Couldn't rename the speaker. Try again.");
      }
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Rename speaker</DialogTitle>
          </DialogHeader>
          <input
            aria-label="Speaker name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={60}
            autoFocus
            className="h-8 rounded-md border border-line bg-white px-2 text-sm focus:border-brand-300 focus:outline-none"
          />
          {error && (
            <p role="alert" className="text-xs text-warn">
              {error}
            </p>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-md px-3 text-sm text-ink-3 hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="h-8 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Rename
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
