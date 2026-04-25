/**
 * Contact directory queries.
 *
 * Server-only data access for /contacts (list + detail). Returns plain
 * shapes ready for the view layer.
 */

import { prisma } from "@/lib/prisma";

// Constants/types live in `@/lib/contact-constants` so client
// components can import them without pulling Prisma into the browser
// bundle. Re-exported here for back-compat with any server callers
// that already import from this module.
export {
  CONTACT_TYPES,
  CONTACT_TYPE_LABEL,
  type ContactType,
} from "@/lib/contact-constants";

export type ContactListRow = {
  id: string;
  name: string;
  type: string;
  organization: string | null;
  email: string | null;
  phone: string | null;
  conflictStatus: string;
  matterCount: number;
};

export async function listContacts({
  search,
  type,
}: {
  search?: string;
  type?: string;
}): Promise<ContactListRow[]> {
  const contacts = await prisma.contact.findMany({
    where: {
      isActive: true,
      ...(type ? { type } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { email: { contains: search } },
              { organization: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }],
    include: {
      _count: {
        select: { mattersAsClient: true, clientMatters: true },
      },
    },
  });

  return contacts.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    organization: c.organization,
    email: c.email,
    phone: c.phone,
    conflictStatus: c.conflictStatus,
    matterCount: c._count.clientMatters + c._count.mattersAsClient,
  }));
}

export type ContactDetail = {
  id: string;
  name: string;
  type: string;
  organization: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  conflictStatus: string;
  createdAt: Date;
  updatedAt: Date;
  /** Matters where this contact is the client (Matter.clientId). */
  asClientMatters: Array<{
    id: string;
    name: string;
    color: string;
    area: string;
    stage: string;
  }>;
  /** Matters where this contact appears as a non-client party. */
  asPartyMatters: Array<{
    id: string;
    matterId: string;
    matterName: string;
    matterColor: string;
    category: string;
    role: string | null;
  }>;
};

export async function getContactById(id: string): Promise<ContactDetail | null> {
  const c = await prisma.contact.findUnique({
    where: { id },
    include: {
      clientMatters: {
        where: { isArchived: false },
        select: {
          id: true,
          name: true,
          color: true,
          practiceArea: { select: { name: true } },
          stage: { select: { name: true } },
        },
      },
      mattersAsClient: {
        include: {
          matter: {
            select: { id: true, name: true, color: true },
          },
        },
      },
    },
  });
  if (!c) return null;

  return {
    id: c.id,
    name: c.name,
    type: c.type,
    organization: c.organization,
    email: c.email,
    phone: c.phone,
    address: c.address,
    city: c.city,
    state: c.state,
    zip: c.zip,
    notes: c.notes,
    conflictStatus: c.conflictStatus,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    asClientMatters: c.clientMatters.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      area: m.practiceArea.name,
      stage: m.stage.name,
    })),
    asPartyMatters: c.mattersAsClient.map((mc) => ({
      id: mc.id,
      matterId: mc.matter.id,
      matterName: mc.matter.name,
      matterColor: mc.matter.color,
      category: mc.category,
      role: mc.role,
    })),
  };
}

/**
 * Aggregate counts per type for the filter pills on /contacts.
 * Active contacts only.
 */
export async function getContactTypeCounts(): Promise<Record<string, number>> {
  const grouped = await prisma.contact.groupBy({
    by: ["type"],
    where: { isActive: true },
    _count: { _all: true },
  });
  const map: Record<string, number> = {};
  for (const g of grouped) map[g.type] = g._count._all;
  return map;
}
