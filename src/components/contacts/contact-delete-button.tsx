/**
 * Contact Delete Button
 *
 * Soft-deletes (isActive=false) the contact and redirects back to the
 * directory. Asks first with a confirmation dialog, like the other
 * row-action deletes across the app.
 */

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteContact } from "@/app/actions/contacts";
import { confirmAction, notifyError } from "@/lib/feedback";

export function ContactDeleteButton({
  contactId,
  contactName,
}: {
  contactId: string;
  contactName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onDelete = async () => {
    if (
      !(await confirmAction({
        title: `Delete "${contactName}"?`,
        description:
          "The contact will be removed from the directory but kept on any matters where they appear so historical records aren't broken.",
        confirmLabel: "Delete contact",
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteContact(contactId);
      if (result.ok) {
        router.push("/contacts");
      } else if (result.error) {
        notifyError(result.error);
      }
    });
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onDelete}
      disabled={pending}
    >
      <Trash2 />
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
