/**
 * Portal card (matter Overview). Staff see who has client-portal
 * access to the matter, invite a contact (client or party with an
 * email), and revoke access. The page renders this only for holders
 * of portal.view; the invite and revoke controls follow portal.invite
 * and portal.revoke, and the server actions re-check all of it.
 *
 * Status labels: "Invited" (never signed in), "Active · last sign-in
 * <date>", "Revoked". Sign-in is an instant, shown in the viewer's zone.
 */

"use client";

import { useEffect, useState, useTransition } from "react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { invitePortalUser, revokePortalAccess } from "@/app/actions/portal-access";
import { setPortalBilling } from "@/app/actions/portal-billing";
import { formatDate } from "@/lib/format-date";
import type { PortalAccessRow } from "@/lib/queries/portal-access";
import { confirmAction } from "@/lib/feedback";

export type PortalContactOption = {
  id: string;
  name: string;
  email: string | null;
};

type InviteState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; error: string };

const inviteInitial: InviteState = { status: "idle" };

export function portalStatusLabel(row: PortalAccessRow, tz: string): string {
  if (row.revokedAt) return "Revoked";
  if (!row.lastSignInAt) return "Invited";
  return `Active · last sign-in ${formatDate(row.lastSignInAt, "medium", tz)}`;
}

export function PortalCard({
  matterId,
  rows,
  contacts,
  canInvite,
  canRevoke,
  portalEnabled,
  portalBillingEnabled,
  billedPortalContacts = [],
  canShareBilling = false,
  tz,
}: {
  matterId: string;
  rows: PortalAccessRow[];
  contacts: PortalContactOption[];
  canInvite: boolean;
  canRevoke: boolean;
  portalEnabled: boolean;
  /** Undefined when the viewer lacks billing.view: no billing section. */
  portalBillingEnabled?: boolean;
  billedPortalContacts?: string[];
  canShareBilling?: boolean;
  tz: string;
}) {
  const [billingOn, setBillingOn] = useState(portalBillingEnabled ?? false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingPending, startBilling] = useTransition();

  const toggleBilling = (next: boolean) => {
    setBillingOn(next);
    setBillingError(null);
    startBilling(async () => {
      try {
        const result = await setPortalBilling(matterId, next);
        if (!result.ok) {
          setBillingOn(!next);
          setBillingError(result.error ?? "Couldn't save.");
        }
      } catch {
        setBillingOn(!next);
        setBillingError("Couldn't save.");
      }
    });
  };

  const [inviteOpen, setInviteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const revoke = async (row: PortalAccessRow) => {
    if (
      !(await confirmAction({
        title: "Revoke portal access?",
        description: `${row.contactName} (${row.email}) will no longer be able to open this matter in the client portal.`,
        confirmLabel: "Revoke access",
        destructive: true,
      }))
    ) {
      return;
    }
    setRevokeError(null);
    startTransition(async () => {
      const result = await revokePortalAccess(row.accessId);
      if (!result.ok) setRevokeError(result.error ?? "Couldn't revoke access.");
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Portal</CardTitle>
          {canInvite && portalEnabled && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setInviteOpen(true)}
            >
              Invite
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {!portalEnabled && (
          <div className="mb-2 text-2xs text-warn">
            The client portal is turned off for the firm. Turn it on in
            Settings → Firm to send invites.
          </div>
        )}
        {revokeError && (
          <div role="alert" className="mb-2 text-2xs text-warn">
            {revokeError}
          </div>
        )}
        {rows.length === 0 ? (
          <div className="py-2 text-xs text-ink-4">
            No one has portal access to this matter.
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((row) => (
              <li
                key={row.accessId}
                className="flex items-center gap-2 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-ink truncate">
                    {row.contactName}
                  </div>
                  <div className="text-2xs text-ink-4 truncate">
                    {row.email}
                  </div>
                  <div className="text-2xs text-ink-3">
                    {portalStatusLabel(row, tz)}
                  </div>
                </div>
                {canRevoke && !row.revokedAt && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => revoke(row)}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {portalBillingEnabled !== undefined && (
          <div className="mt-3 border-t border-line pt-3">
            <label
              className="flex items-start gap-2 text-xs select-none"
              title={
                canShareBilling
                  ? undefined
                  : "You need permission to share billing in the portal."
              }
            >
              <input
                type="checkbox"
                role="switch"
                checked={billingOn}
                disabled={!canShareBilling || billingPending}
                onChange={(e) => toggleBilling(e.target.checked)}
                className="h-3.5 w-3.5 mt-0.5 rounded border-line"
              />
              <span className="text-ink font-medium">
                Show billing in the portal
              </span>
            </label>
            {!canShareBilling && (
              <div className="mt-1 text-2xs text-ink-4">
                You need permission to share billing in the portal.
              </div>
            )}
            {billingError && (
              <div role="alert" className="mt-1 text-2xs text-warn">
                {billingError}
              </div>
            )}
            {billingOn && (
              <div className="mt-1 text-2xs text-ink-3">
                {billedPortalContacts.length > 0
                  ? `Visible to: ${billedPortalContacts.join(", ")}`
                  : "No billed contact has portal access yet."}
              </div>
            )}
          </div>
        )}
      </CardContent>
      {canInvite && (
        <InviteDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          matterId={matterId}
          contacts={contacts}
        />
      )}
    </Card>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  matterId,
  contacts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matterId: string;
  contacts: PortalContactOption[];
}) {
  // The form body unmounts with the dialog content, so contact/email
  // re-seed on every open; the action reads them from FormData.
  const action = async (
    _prev: InviteState,
    fd: FormData
  ): Promise<InviteState> => {
    const result = await invitePortalUser(
      matterId,
      String(fd.get("contactId") ?? ""),
      String(fd.get("email") ?? "")
    );
    return result.ok
      ? { status: "ok" }
      : { status: "error", error: result.error };
  };
  const [state, formAction, isPending] = useDialogActionState<
    InviteState,
    FormData
  >(action, inviteInitial, open);

  // Keyed on the state object so every fresh success closes the dialog.
  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite to the client portal</DialogTitle>
          <DialogDescription>
            We email a sign-in link that lasts 7 days. The person can then
            see this matter in the portal.
          </DialogDescription>
        </DialogHeader>
        <InviteForm
          contacts={contacts}
          formAction={formAction}
          isPending={isPending}
          error={state.status === "error" ? state.error : null}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({
  contacts,
  formAction,
  isPending,
  error,
  onCancel,
}: {
  contacts: PortalContactOption[];
  formAction: (payload: FormData) => void;
  isPending: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const [email, setEmail] = useState(contacts[0]?.email ?? "");

  const pick = (id: string) => {
    setContactId(id);
    setEmail(contacts.find((c) => c.id === id)?.email ?? "");
  };

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-ink-2">
        Contact
        <NativeSelect
          className="w-full"
          name="contactId"
          value={contactId}
          onChange={(e) => pick(e.target.value)}
        >
          {contacts.map((c) => (
            <NativeSelectOption key={c.id} value={c.id}>
              {c.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-2">
        Email
        <input
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-8 rounded-md border border-line bg-paper px-2 text-xs text-ink"
        />
      </label>
      {error && (
        <div role="alert" className="text-2xs text-warn">
          {error}
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isPending || !contactId || !email.trim()}
        >
          {isPending ? "Sending…" : "Send invite"}
        </Button>
      </DialogFooter>
    </form>
  );
}
