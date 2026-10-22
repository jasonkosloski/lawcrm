/**
 * Matter Create Menu
 *
 * "+ Create" dropdown in the matter detail header. Entries come from
 * the shared registry in `src/lib/matter-create-types.ts`.
 *
 * Only "Add note" has a working composer in the Create dock
 * (`useCreateStack().open(type)` — panels stack, each new open
 * minimizes the focused panel to a chip). Every other entry already has
 * a working composer on its matter tab, so the menu navigates there
 * instead of opening a dead-end placeholder panel. Entries can be
 * filtered with `allowedTypes` (the server passes the types the viewer
 * may create); omitted = all.
 */

"use client";

import { useRouter } from "next/navigation";
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
  type MatterCreateType,
} from "@/lib/matter-create-types";
import { useCreateStack } from "@/components/create-stack/create-stack-provider";

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

/** Types that have a real form in the Create dock. */
const DOCK_TYPES: ReadonlySet<MatterCreateType> = new Set(["note"]);

/** Matter tab (route segment) whose composer handles each other type. */
export const MATTER_CREATE_TAB: Record<Exclude<MatterCreateType, "note">, string> = {
  time: "time",
  task: "tasks",
  deadline: "deadlines",
  party: "parties",
  document: "documents",
  event: "events",
  invoice: "billing",
};

const GROUP_LABEL: Record<MatterCreateGroup, string> = {
  track: "Track",
  capture: "Capture",
  connect: "Connect",
  bill: "Bill",
};

const GROUP_ORDER: MatterCreateGroup[] = ["track", "capture", "connect", "bill"];

export function MatterCreateMenu({
  allowedTypes,
}: {
  /** Entries the viewer may create (resolved server-side from the
   *  permission each panel's action enforces). Omitted = all. */
  allowedTypes?: readonly MatterCreateType[];
} = {}) {
  const { open, context } = useCreateStack();
  const router = useRouter();
  const matterId = context?.matterId ?? null;

  const choose = (type: MatterCreateType) => {
    if (DOCK_TYPES.has(type) || !matterId) {
      open(type);
      return;
    }
    router.push(
      `/matters/${matterId}/${MATTER_CREATE_TAB[type as keyof typeof MATTER_CREATE_TAB]}`,
    );
  };

  const byGroup = new Map<MatterCreateGroup, MatterCreateEntry[]>();
  for (const e of MATTER_CREATE_ENTRIES) {
    if (allowedTypes && !allowedTypes.includes(e.type)) continue;
    if (!byGroup.has(e.group)) byGroup.set(e.group, []);
    byGroup.get(e.group)!.push(e);
  }

  // Nothing creatable for this viewer - no empty dropdown.
  if (byGroup.size === 0) return null;

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
        {GROUP_ORDER.filter((g) => (byGroup.get(g)?.length ?? 0) > 0).map((group, idx) => {
          const entries = byGroup.get(group)!;
          return (
            <DropdownMenuGroup key={group}>
              {idx > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{GROUP_LABEL[group]}</DropdownMenuLabel>
              {entries.map((e) => {
                const Icon = ICON_MAP[e.icon];
                return (
                  <DropdownMenuItem key={e.type} onClick={() => choose(e.type)}>
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
