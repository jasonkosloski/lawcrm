/**
 * Email Signature Form — the current user's signature on Settings →
 * Profile. Same rich-text editor as the email composers; the server
 * action sanitizes on save, and an empty editor clears the signature.
 * Compose and reply start with it (src/lib/email-signature.ts).
 *
 * Its own card and Save button, separate from the profile form, so a
 * profile validation error can't hold the signature hostage.
 */

"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateEmailSignatureAction } from "@/app/actions/profile";
import { RichTextEditor } from "@/components/shared/rich-text-editor-lazy";

export function EmailSignatureForm({
  signature,
}: {
  /** Stored signature HTML; null = none. */
  signature: string | null;
}) {
  const [html, setHtml] = useState(signature ?? "");
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = (): void => {
    startTransition(async () => {
      const result = await updateEmailSignatureAction(html);
      if (result.ok) {
        setStatus("ok");
        setError(null);
      } else {
        setStatus("error");
        setError(result.error);
      }
    });
  };

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-ink">Email signature</h2>
      <p className="mt-1 mb-3 text-xs text-ink-3">
        Added below a &ldquo;--&rdquo; line when you compose or reply.
        Text and links only; images aren&apos;t supported.
      </p>
      <RichTextEditor
        initialHTML={signature ?? ""}
        onChange={(next) => {
          setHtml(next);
          setStatus("idle");
          setError(null);
        }}
        placeholder="Your name, title, firm, phone…"
      />
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className={cn(
            "inline-flex items-center h-9 px-4 rounded-md text-sm font-medium",
            "bg-brand-700 text-white hover:bg-brand-900 transition-colors",
            "disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          {isPending ? "Saving…" : "Save signature"}
        </button>
        {status === "ok" && (
          <span className="inline-flex items-center gap-1.5 text-2xs text-ok">
            <CheckCircle2 size={12} />
            Saved
          </span>
        )}
      </div>
    </section>
  );
}
