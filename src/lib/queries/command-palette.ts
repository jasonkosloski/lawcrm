/**
 * Command Palette data
 *
 * One fetch that returns everything the palette can search across:
 * matters, contacts, leads, and firm users. Called when the palette
 * opens — each kind is capped at 500 most-recently-updated rows and
 * projected down to the handful of fields the palette renders, so we
 * fetch it all and let the client (cmdk) filter/rank in-memory.
 *
 * This is a server action, callable from client components.
 */

"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { LEAD_CLOSED_STAGES } from "@/lib/constants/lead-stage";

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
  jobTitle: string;
};

export type PaletteItem =
  | PaletteMatter
  | PaletteContact
  | PaletteLead
  | PaletteUser;

export type PaletteData = {
  items: PaletteItem[];
};

/** 500-row cap per kind, most-recently-updated first. Same safety
 *  net as listContacts / listMatters / listThreads: covers a
 *  small/mid firm outright, and when a firm outgrows the ceiling
 *  the rows the palette silently drops are the stalest ones —
 *  exactly the ones least likely to be reached for. */
const PALETTE_CAP = 500;

export async function getPaletteData(): Promise<PaletteData> {
  const userId = await getCurrentUserId();
  // Narrow `select`s throughout — this action fires on every
  // palette open, and the palette renders 3-5 fields per kind, so
  // pulling whole rows (contact addresses/notes, lead assessments)
  // is serialization weight for nothing.
  const [matters, contacts, leads, users] = await Promise.all([
    prisma.matter.findMany({
      where: { isArchived: false },
      select: {
        id: true,
        name: true,
        caseNumber: true,
        color: true,
        client: { select: { name: true } },
        practiceArea: { select: { name: true } },
        stage: { select: { name: true } },
        pins: { where: { userId }, select: { userId: true }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
      take: PALETTE_CAP,
    }),
    prisma.contact.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        organization: true,
        type: true,
      },
      orderBy: { updatedAt: "desc" },
      take: PALETTE_CAP,
    }),
    prisma.lead.findMany({
      where: { stage: { notIn: [...LEAD_CLOSED_STAGES] } },
      select: { id: true, name: true, email: true, stage: true },
      orderBy: { updatedAt: "desc" },
      take: PALETTE_CAP,
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, initials: true, jobTitle: true },
      orderBy: { updatedAt: "desc" },
      take: PALETTE_CAP,
    }),
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
        jobTitle: u.jobTitle,
      })
    ),
  ];

  return { items };
}
