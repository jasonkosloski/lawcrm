/**
 * Gmail integration card on /settings/integrations.
 *
 * Renders the CURRENT USER's connected Gmail accounts (the model
 * allows several addresses per user — list + "Connect another"),
 * the one-shot ?connected/?error banners from the OAuth callback
 * redirect, and per-account status: sync chip, last sync, thread
 * count, surfaced syncError, Disconnect with an inline two-step
 * confirm (the codebase's lightweight confirm idiom — no dialog).
 *
 * When the deploy has no GOOGLE_CLIENT_ID/SECRET, renders setup
 * guidance instead of a connect button that would bounce.
 *
 * "Connect" is a plain <a> to the OAuth redirect route — a
 * top-level navigation, not a fetch, because Google's consent
 * screen must load in this tab.
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Plus } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { disconnectEmailAccount } from "@/app/actions/email-accounts";

const CONNECT_URL = "/api/integrations/google/connect";

/** Callback machine codes → human copy. Unknown codes get the
 *  generic line — never render a raw code to the user. */
const ERROR_COPY: Record<string, string> = {
  denied:
    "Google connection was cancelled — no account was linked. Try again when you're ready.",
  state:
    "The connection attempt could not be verified (it may have expired or been opened in a different browser). Start again from this page.",
  exchange:
    "Google didn't complete the authorization. Try connecting again.",
  userinfo:
    "Connected to Google, but the mailbox address couldn't be read. Try connecting again.",
  not_configured:
    "The Google integration isn't configured on this deployment yet.",
};

export interface GmailAccountView {
  id: string;
  emailAddress: string;
  /** connected | syncing | disconnected | error */
  syncStatus: string;
  /** Preformatted server-side (user TZ) — null = never synced. */
  lastSyncLabel: string | null;
  threadCount: number;
  syncError: string | null;
}

export function GmailIntegrationCard({
  configured,
  accounts,
  justConnected,
  errorCode,
}: {
  configured: boolean;
  accounts: GmailAccountView[];
  justConnected: boolean;
  errorCode: string | null;
}) {
  const hasAccounts = accounts.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Mail size={15} className="text-brand-600" />
          Gmail
        </CardTitle>
        <p className="text-xs text-ink-3">
          Sync and send email from your own Google mailbox. Filed threads
          stay on their matters even if you disconnect.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {justConnected && (
          <div className="rounded-md bg-ok-soft px-3 py-2 text-xs text-ok">
            Gmail connected. Email sync will begin shortly.
          </div>
        )}
        {errorCode && (
          <div className="rounded-md bg-warn-soft px-3 py-2 text-xs text-danger">
            {ERROR_COPY[errorCode] ??
              "Something went wrong connecting Gmail. Try again."}
          </div>
        )}

        {!configured ? (
          <div className="rounded-md border border-border bg-paper-2 px-3 py-2.5 text-xs text-ink-3">
            <p className="font-medium text-ink-2">Not configured</p>
            <p className="mt-1">
              Gmail connections need a Google OAuth app. Set{" "}
              <code className="text-2xs">GOOGLE_CLIENT_ID</code> and{" "}
              <code className="text-2xs">GOOGLE_CLIENT_SECRET</code> in the
              environment (see <code className="text-2xs">.env.example</code>{" "}
              for the redirect-URI registration steps), then reload this
              page.
            </p>
          </div>
        ) : (
          <>
            {hasAccounts && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {accounts.map((account) => (
                  <GmailAccountRow key={account.id} account={account} />
                ))}
              </ul>
            )}
            <Button
              variant={hasAccounts ? "outline" : "default"}
              size="sm"
              render={<a href={CONNECT_URL} />}
            >
              <Plus size={13} />
              {hasAccounts ? "Connect another mailbox" : "Connect Gmail"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_CHIP: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }
> = {
  connected: {
    label: "Connected",
    variant: "secondary",
    className: "bg-ok-soft text-ok",
  },
  syncing: {
    label: "Syncing",
    variant: "secondary",
    className: "bg-brand-soft text-brand-700",
  },
  disconnected: { label: "Disconnected", variant: "outline" },
  error: { label: "Needs attention", variant: "destructive" },
};

function GmailAccountRow({ account }: { account: GmailAccountView }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const chip = STATUS_CHIP[account.syncStatus] ?? {
    label: account.syncStatus,
    variant: "outline" as const,
  };
  const isDisconnected = account.syncStatus === "disconnected";

  const disconnect = () => {
    startTransition(async () => {
      const res = await disconnectEmailAccount(account.id);
      if (!res.ok) {
        setActionError(res.error);
      } else {
        setActionError(null);
        // Server action revalidates the page; refresh picks it up.
        router.refresh();
      }
      setConfirming(false);
    });
  };

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-medium text-ink">
          {account.emailAddress}
        </span>
        <Badge variant={chip.variant} className={cn(chip.className)}>
          {chip.label}
        </Badge>
        <span className="text-2xs text-ink-4">
          {account.lastSyncLabel
            ? `Last sync ${account.lastSyncLabel}`
            : "Never synced"}
          {" · "}
          {account.threadCount}{" "}
          {account.threadCount === 1 ? "thread" : "threads"}
        </span>

        <span className="ml-auto flex items-center gap-1.5">
          {isDisconnected ? (
            <Button
              variant="outline"
              size="sm"
              render={<a href={CONNECT_URL} />}
            >
              Reconnect
            </Button>
          ) : confirming ? (
            <>
              <span className="text-2xs text-ink-3">Disconnect mailbox?</span>
              <Button
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={disconnect}
              >
                {pending ? "Disconnecting…" : "Confirm"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-ink-3"
              onClick={() => setConfirming(true)}
            >
              Disconnect
            </Button>
          )}
        </span>
      </div>

      {account.syncError && (
        <p className="mt-1.5 text-2xs text-danger">{account.syncError}</p>
      )}
      {actionError && (
        <p className="mt-1.5 text-2xs text-danger">{actionError}</p>
      )}
    </li>
  );
}
