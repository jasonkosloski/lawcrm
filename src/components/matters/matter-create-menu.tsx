/**
 * Matter Create Menu
 *
 * "+ Create" dropdown in the matter detail header. Shows every thing a
 * user can create under the current matter (time, note, task, deadline,
 * party, document, event, invoice), grouped by domain. Each item routes
 * to `/matters/<id>/new/<type>` which is a placeholder today — real
 * forms replace the placeholder as they're built.
 *
 * Entries come from the shared registry in
 * `src/lib/matter-create-types.ts` so the menu and the placeholder page
 * stay in sync.
 */

"use client";

import Link from "next/link";
import {
  Calendar,
  Clock,
  FileText,
  Plus,
  Receipt,
  StickyNote,
  CircleAlert,
  ListTodo,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MATTER_CREATE_ENTRIES,
  type MatterCreateEntry,
  type MatterCreateGroup,
} from "@/lib/matter-create-types";

const ICON_MAP: Record<MatterCreateEntry["icon"], LucideIcon> = {
  clock: Clock,
  note: StickyNote,
  task: ListTodo,
  deadline: CircleAlert,
  users: Users,
  document: FileText,
  calendar: Calendar,
  invoice: Receipt,
};

const GROUP_LABEL: Record<MatterCreateGroup, string> = {
  track: "Track",
  capture: "Capture",
  connect: "Connect",
  bill: "Bill",
};

const GROUP_ORDER: MatterCreateGroup[] = [
  "track",
  "capture",
  "connect",
  "bill",
];

export function MatterCreateMenu({ matterId }: { matterId: string }) {
  const byGroup = new Map<MatterCreateGroup, MatterCreateEntry[]>();
  for (const e of MATTER_CREATE_ENTRIES) {
    if (!byGroup.has(e.group)) byGroup.set(e.group, []);
    byGroup.get(e.group)!.push(e);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm">
            <Plus />
            Create
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        {GROUP_ORDER.map((group, idx) => {
          const entries = byGroup.get(group);
          if (!entries || entries.length === 0) return null;
          return (
            <DropdownMenuGroup key={group}>
              {idx > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{GROUP_LABEL[group]}</DropdownMenuLabel>
              {entries.map((e) => {
                const Icon = ICON_MAP[e.icon];
                return (
                  <DropdownMenuItem
                    key={e.type}
                    render={
                      <Link href={`/matters/${matterId}/new/${e.type}`} />
                    }
                  >
                    <Icon />
                    {e.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
