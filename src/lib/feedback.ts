/**
 * Client-side feedback after an action: toasts and confirmation dialogs.
 * Replaces window.alert() / window.confirm(), which block the page and
 * ignore the brand. Toasts render in the <Toaster> and confirmations in
 * the <ConfirmHost>, both mounted once in src/components/providers.tsx.
 *
 * Tests mock this module (`vi.mock("@/lib/feedback")`) instead of
 * stubbing window globals.
 */

import { toast } from "sonner";

/** An action failed: the server's message, or what to try next. */
export function notifyError(message: string): void {
  toast.error(message);
}

/** Done, but part of it didn't go through (e.g. saved, email failed). */
export function notifyWarning(message: string): void {
  toast.warning(message);
}

/** An action worked and nothing else on screen shows it. */
export function notifySuccess(message: string): void {
  toast.success(message);
}

export type ConfirmOptions = {
  /** The question, e.g. "Delete this note?" */
  title: string;
  /** Consequences, e.g. "This can't be undone." */
  description?: string;
  /** Names the action, e.g. "Delete note". Defaults to "Continue". */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Red confirm button for deletes and other losses. */
  destructive?: boolean;
};

type Request = ConfirmOptions & { resolve: (ok: boolean) => void };
type Listener = (req: Request) => void;

let listener: Listener | null = null;

/** Called by ConfirmHost on mount; returns the unsubscribe. */
export function registerConfirmHost(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/**
 * Ask before doing something. Resolves true on confirm, false on cancel
 * or dismiss. Without a mounted host (never in the app) it resolves false
 * so nothing irreversible runs unconfirmed.
 */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (!listener) return Promise.resolve(false);
  const host = listener;
  return new Promise((resolve) => host({ ...opts, resolve }));
}
