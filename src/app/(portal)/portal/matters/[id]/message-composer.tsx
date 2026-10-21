"use client";

/** Composer for a portal message. Enter inserts a newline; Send is the only way to submit. */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { sendPortalMessage } from "@/app/actions/portal-messages-client";

const MAX_LENGTH = 5000;

export function MessageComposer({ matterId }: { matterId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await sendPortalMessage(matterId, draft);
        if (res.ok) {
          setDraft("");
          router.refresh();
        } else {
          setError(res.error);
        }
      } catch {
        setError("Couldn't send. Please try again.");
      }
    });
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label htmlFor="portal-message" className="text-sm font-medium text-ink-2">
        Write a message
      </label>
      <textarea
        id="portal-message"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={MAX_LENGTH}
        rows={4}
        disabled={pending}
        className="w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        className="h-10 self-start px-5"
        disabled={pending || draft.trim().length === 0}
      >
        Send
      </Button>
    </form>
  );
}
