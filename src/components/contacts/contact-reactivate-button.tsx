/**
 * Contact Reactivate Button
 *
 * Undoes a soft delete (isActive=false): the contact returns to the
 * directory, pickers and attendee search. Shown on the detail page of
 * a deactivated contact to contacts.delete holders (the same key that
 * can deactivate), in place of the Delete button.
 */

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reactivateContact } from "@/app/actions/contacts";
import { confirmAction, notifyError } from "@/lib/feedback";

export function ContactReactivateButton({
  contactId,
  contactName,
}: {
  contactId: string;
  contactName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onReactivate = async () => {
    if (
      !(await confirmAction({
        title: `Reactivate "${contactName}"?`,
        description:
          "They will appear in the directory, pickers and conflict-check lists again.",
        confirmLabel: "Reactivate contact",
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const result = await reactivateContact(contactId);
      if (result.ok) {
        router.refresh();
      } else if (result.error) {
        notifyError(result.error);
      }
    });
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onReactivate}
      disabled={pending}
    >
      <RotateCcw />
      {pending ? "Reactivating…" : "Reactivate"}
    </Button>
  );
}
