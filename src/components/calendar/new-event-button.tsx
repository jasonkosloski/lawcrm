/**
 * New Event Button
 *
 * Toolbar split for the calendar top bar:
 *
 *   - Primary "New event" → navigates to the full-page create at
 *     /calendar/events/new (matter picker, attendee picker,
 *     visibility — the whole edit-parity form).
 *   - Secondary zap icon → opens the docked quick composer in the
 *     surrounding CreateStackProvider (the original one-click
 *     inline path — still the fastest way to block time without
 *     leaving the calendar).
 */

"use client";

import Link from "next/link";
import { Plus, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateStack } from "@/components/create-stack/create-stack-provider";

export function NewEventButton() {
  const { open } = useCreateStack();
  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        render={
          <Link href="/calendar/events/new">
            <Plus />
            New event
          </Link>
        }
      />
      <Button
        size="icon-sm"
        variant="outline"
        onClick={() => open("event")}
        title="Quick event (docked composer)"
        aria-label="Quick event"
      >
        <Zap />
      </Button>
    </div>
  );
}
