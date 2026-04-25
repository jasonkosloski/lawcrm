/**
 * Contact Delete Button
 *
 * Soft-deletes (isActive=false) the contact and redirects back to the
 * directory. Uses confirm() — same pattern as the other row-action
 * deletes across the app.
 */

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteContact } from "@/app/actions/contacts";

export function ContactDeleteButton({
  contactId,
  contactName,
}: {
  contactId: string;
  contactName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onDelete = () => {
    if (
      !confirm(
        `Delete this contact?\n\n"${contactName}"\n\nThe contact will be removed from the directory but kept on any matters where they appear so historical records aren't broken.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteContact(contactId);
      if (result.ok) {
        router.push("/contacts");
      } else if (result.error) {
        alert(result.error);
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
