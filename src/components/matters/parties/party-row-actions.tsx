/**
 * Party Row Actions — delete control on each party row.
 * Removes the MatterContact link (doesn't delete the Contact itself
 * so the same person can still appear in other matters).
 */

"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { removeMatterContact } from "@/app/actions/parties";

export function PartyRowActions({
  matterContactId,
  name,
}: {
  matterContactId: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();

  const onDelete = () => {
    if (!confirm(`Remove ${name} from this matter?`)) return;
    startTransition(async () => {
      const res = await removeMatterContact(matterContactId);
      if (!res.ok && res.error) alert(res.error);
    });
  };

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={pending}
      title="Remove from matter"
      aria-label="Remove party"
      className={cn(
        "inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:text-warn hover:bg-warn-soft transition-colors",
        pending && "opacity-60 cursor-wait"
      )}
    >
      <Trash2 size={12} />
    </button>
  );
}
