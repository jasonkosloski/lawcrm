/**
 * Matter Create Menu
 *
 * "+ Create" dropdown in the matter detail header. Opens a new panel
 * in the matter Create stack via `useMatterCreateStack().open(type)`.
 * Multiple panels can be open at once — each new open minimizes the
 * current focused panel to a chip at bottom-right.
 *
 * Entries come from the shared registry in
 * `src/lib/matter-create-types.ts`.
 */

"use client";

import {
  Calendar,
  Clock,
  FileText,
  Plus,
  Receipt,
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
import { useCreateStack } from "@/components/create-stack/create-stack-provider";

const ICON_MAP: Record<MatterCreateEntry["icon"], LucideIcon> = {
  clock: Clock,
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

export function MatterCreateMenu() {
  const { open } = useCreateStack();

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
                    onClick={() => open(e.type)}
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
