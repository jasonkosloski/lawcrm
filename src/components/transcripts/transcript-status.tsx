/** Status surfaces for a transcript that isn't (only) readable text. */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { requestTranscript } from "@/app/actions/transcripts";
import { confirmAction, notifyError } from "@/lib/feedback";
import { formatShortTimecode } from "@/lib/transcription/timecode";

/** Request (or re-run) a transcript; asks first when it would drop corrections. */
export function useRequestTranscript(documentId: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const run = async () => {
    setPending(true);
    try {
      let res = await requestTranscript(documentId);
      if (!res.ok && res.needsConfirm === "replace_corrections") {
        const ok = await confirmAction({
          title: "Replace the corrected transcript?",
          description:
            "Re-running transcribes the recording again and discards the corrections made to this transcript.",
          confirmLabel: "Re-transcribe",
          destructive: true,
        });
        if (!ok) return;
        res = await requestTranscript(documentId, { replaceCorrections: true });
      }
      if (!res.ok) {
        notifyError(res.error);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  };
  return { run, pending };
}

export function TranscribeButton({
  documentId,
  durationSeconds,
}: {
  documentId: string;
  durationSeconds: number | null;
}) {
  const { run, pending } = useRequestTranscript(documentId);
  const label =
    durationSeconds != null && durationSeconds > 0
      ? `Transcribe (${formatShortTimecode(durationSeconds)})`
      : "Transcribe";
  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className="inline-flex h-8 items-center gap-1.5 self-start rounded-md border border-line bg-white px-3 text-xs font-medium text-ink-2 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-60"
    >
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {label}
    </button>
  );
}

export function InFlightNotice() {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-line bg-paper-2 px-3 py-2 text-xs text-ink-2"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      Transcribing. This can take a few minutes. It is safe to leave this page.
    </div>
  );
}

export function FailedBanner({
  documentId,
  error,
  canTranscribe,
}: {
  documentId: string;
  error: string | null;
  canTranscribe: boolean;
}) {
  const { run, pending } = useRequestTranscript(documentId);
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-warn-border bg-warn-soft px-3 py-2 text-xs text-warn"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Transcription failed</div>
        {error && <div className="break-words">{error}</div>}
      </div>
      {canTranscribe && (
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="shrink-0 rounded-md border border-warn-border bg-white px-2 py-1 font-medium hover:bg-paper-2 disabled:opacity-60"
        >
          Retry
        </button>
      )}
    </div>
  );
}
