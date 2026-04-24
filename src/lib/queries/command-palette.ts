/**
 * Command Palette data
 *
 * One fetch that returns everything the palette can search across:
 * matters, contacts, leads, and firm users. Called when the palette
 * opens — a few hundred rows at most, so we fetch it all and let the
 * client (cmdk) filter/rank in-memory.
 *
 * This is a server action, callable from client components.
 */

"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

export type PaletteMatter = {
  kind: "matter";
  id: string;
  name: string;
  caseNumber: string | null;
  area: string;
  stage: string;
  color: string;
  clientName: string | null;
  isPinned: boolean;
  isArchived: boolean;
};

export type PaletteContact = {
  kind: "contact";
  id: string;
  name: string;
  email: string | null;
  organization: string | null;
  contactType: string;
};

export type PaletteLead = {
  kind: "lead";
  id: string;
  name: string;
  email: string | null;
  stage: string;
};

export type PaletteUser = {
  kind: "user";
  id: string;
  name: string;
  initials: string;
  role: string;
};

export type PaletteItem =
  | PaletteMatter
  | PaletteContact
  | PaletteLead
  | PaletteUser;

export type PaletteData = {
  items: PaletteItem[];
  pinnedMatterIds: string[];
};

export async function getPaletteData(): Promise<PaletteData> {
  const userId = await getCurrentUserId();
  const [matters, contacts, leads, users] = await Promise.all([
    prisma.matter.findMany({
      where: { isArchived: false },
      include: {
        client: { select: { name: true } },
        practiceArea: { select: { name: true } },
        stage: { select: { name: true } },
        pins: { where: { userId }, select: { userId: true }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.contact.findMany({ where: { isActive: true } }),
    prisma.lead.findMany({
      where: { stage: { notIn: ["converted", "declined"] } },
    }),
    prisma.user.findMany({ where: { isActive: true } }),
  ]);

  const items: PaletteItem[] = [
    ...matters.map(
      (m): PaletteMatter => ({
        kind: "matter",
        id: m.id,
        name: m.name,
        caseNumber: m.caseNumber,
        area: m.practiceArea.name,
        stage: m.stage.name,
        color: m.color,
        clientName: m.client?.name ?? null,
        isPinned: m.pins.length > 0,
        isArchived: m.isArchived,
      })
    ),
    ...contacts.map(
      (c): PaletteContact => ({
        kind: "contact",
        id: c.id,
        name: c.name,
        email: c.email,
        organization: c.organization,
        contactType: c.type,
      })
    ),
    ...leads.map(
      (l): PaletteLead => ({
        kind: "lead",
        id: l.id,
        name: l.name,
        email: l.email,
        stage: l.stage,
      })
    ),
    ...users.map(
      (u): PaletteUser => ({
        kind: "user",
        id: u.id,
        name: u.name,
        initials: u.initials,
        role: u.role,
      })
    ),
  ];

  return {
    items,
    pinnedMatterIds: matters
      .filter((m) => m.pins.length > 0)
      .map((m) => m.id),
  };
}
