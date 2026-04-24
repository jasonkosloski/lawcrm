/**
 * New Event Button
 *
 * "+ New event" button for the calendar top bar. Opens an `event`
 * panel in the surrounding CreateStackProvider rather than navigating
 * to a separate page — same pattern as the matter detail "Create"
 * dropdown, but scoped to a single type since the calendar only
 * creates events.
 */

"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateStack } from "@/components/create-stack/create-stack-provider";

export function NewEventButton() {
  const { open } = useCreateStack();
  return (
    <Button size="sm" onClick={() => open("event")}>
      <Plus />
      New event
    </Button>
  );
}
