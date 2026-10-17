/**
 * Contact directory queries.
 *
 * Server-only data access for /contacts (list + detail). Returns plain
 * shapes ready for the view layer.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { canAccessMatter, matterAccessWhere } from "@/lib/matter-access";
import {
  CONTACT_LIST_LIMIT,
  CONTACT_PICKER_LIMIT,
  MERGE_SEARCH_LIMIT,
} from "@/lib/contact-constants";

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

/**
 * Active contacts for the /contacts directory, A-Z, capped at
 * CONTACT_LIST_LIMIT (the page shows a "refine your search" notice
 * when the cap is hit). Search is trimmed and case-insensitive over
 * name, email and organization.
 *
 * `matterCount` is the number of DISTINCT matters the contact touches:
 * as the matter's client (Matter.clientId), as any party row
 * (MatterContact - which also holds a category "client" row for every
 * client), or as a party's representation. Summing the raw relation
 * counts would count a client's matter twice.
 */
export async function listContacts({
  search,
  type,
}: {
  search?: string;
  type?: string;
}): Promise<ContactListRow[]> {
  const q = search?.trim();
  // Matter wall: the per-contact matter count only counts matters the
  // viewer can access (a hidden matter must not leak via the count).
  const mw = await matterAccessWhere(await getCurrentUserId());
  const walled = Object.keys(mw).length > 0;
  const contacts = await prisma.contact.findMany({
    where: {
      isActive: true,
      ...(type ? { type } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
              { organization: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    take: CONTACT_LIST_LIMIT,
    orderBy: [{ name: "asc" }],
    include: {
      clientMatters: { where: mw, select: { id: true } },
      mattersAsClient: {
        where: walled ? { matter: mw } : {},
        select: { matterId: true },
      },
      representationOf: {
        where: walled ? { matter: mw } : {},
        select: { matterId: true },
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
    matterCount: new Set([
      ...c.clientMatters.map((m) => m.id),
      ...c.mattersAsClient.map((m) => m.matterId),
      ...c.representationOf.map((m) => m.matterId),
    ]).size,
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
  /** False once the contact was deactivated (soft-deleted) or merged
   *  away. The detail page labels it and offers Reactivate. */
  isActive: boolean;
  /** Set when this record was merged away — the survivor's id. The
   *  detail page redirects there instead of rendering. */
  mergedIntoId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Full phone list, display order. The primary's number is also
   *  mirrored on `phone` above. */
  phones: Array<{
    id: string;
    label: string | null;
    number: string;
    isPrimary: boolean;
  }>;
  /** Matters where this contact is the client (Matter.clientId). */
  asClientMatters: Array<{
    id: string;
    name: string;
    color: string;
    area: string;
    stage: string;
    isArchived: boolean;
  }>;
  /** Matters where this contact appears as a party. A category
   *  "client" row for the matter's own client is NOT repeated here
   *  (it is already in `asClientMatters`); co-client rows are. */
  asPartyMatters: Array<{
    id: string;
    matterId: string;
    matterName: string;
    matterColor: string;
    category: string;
    role: string | null;
    isArchived: boolean;
  }>;
  /** Party rows this contact represents (they are the party's
   *  attorney, via MatterContact.representationContactId) - opposing
   *  counsel usually has no party row of their own. */
  representing: Array<{
    id: string;
    matterId: string;
    matterName: string;
    matterColor: string;
    partyName: string;
    isArchived: boolean;
  }>;
  /** Distinct matters across the three lists above. */
  matterCount: number;
};

export async function getContactById(id: string): Promise<ContactDetail | null> {
  // Matter wall: the contact itself is firm-wide, but the matters it
  // is tied to are listed (and counted) only when the viewer can see
  // them. Everything below filters at the query, so hidden names,
  // colors and counts never leave the server.
  const mw = await matterAccessWhere(await getCurrentUserId());
  const walled = Object.keys(mw).length > 0;
  const c = await prisma.contact.findUnique({
    where: { id },
    include: {
      phones: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true, label: true, number: true, isPrimary: true },
      },
      clientMatters: {
        where: mw,
        select: {
          id: true,
          name: true,
          color: true,
          isArchived: true,
          practiceArea: { select: { name: true } },
          stage: { select: { name: true } },
        },
      },
      mattersAsClient: {
        where: walled ? { matter: mw } : {},
        include: {
          matter: {
            select: {
              id: true,
              name: true,
              color: true,
              clientId: true,
              isArchived: true,
            },
          },
        },
      },
      representationOf: {
        where: walled ? { matter: mw } : {},
        select: {
          id: true,
          contact: { select: { name: true } },
          matter: {
            select: { id: true, name: true, color: true, isArchived: true },
          },
        },
      },
    },
  });
  if (!c) return null;

  const asClientMatters = c.clientMatters.map((m) => ({
    id: m.id,
    name: m.name,
    color: m.color,
    area: m.practiceArea.name,
    stage: m.stage.name,
    isArchived: m.isArchived,
  }));
  // createMatter / updateMatter keep a category "client" MatterContact
  // row for Matter.clientId; listing it again would show the same
  // matter twice. Co-clients (a client row on a matter whose clientId
  // is somebody else) still appear.
  const asPartyMatters = c.mattersAsClient
    .filter((mc) => !(mc.category === "client" && mc.matter.clientId === c.id))
    .map((mc) => ({
      id: mc.id,
      matterId: mc.matter.id,
      matterName: mc.matter.name,
      matterColor: mc.matter.color,
      category: mc.category,
      role: mc.role,
      isArchived: mc.matter.isArchived,
    }));
  const representing = c.representationOf.map((r) => ({
    id: r.id,
    matterId: r.matter.id,
    matterName: r.matter.name,
    matterColor: r.matter.color,
    partyName: r.contact.name,
    isArchived: r.matter.isArchived,
  }));

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
    isActive: c.isActive,
    mergedIntoId: c.mergedIntoId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    phones: c.phones,
    asClientMatters,
    asPartyMatters,
    representing,
    matterCount: new Set([
      ...asClientMatters.map((m) => m.id),
      ...asPartyMatters.map((m) => m.matterId),
      ...representing.map((m) => m.matterId),
    ]).size,
  };
}

/** Light option row for pickers (e.g. the Log-a-call composer's
 *  contact typeahead). `phone` is the display number — primary
 *  ContactPhone first, denormalized Contact.phone as fallback. */
export type ContactPickerOption = {
  id: string;
  name: string;
  type: string;
  organization: string | null;
  phone: string | null;
};

const PICKER_SELECT = {
  id: true,
  name: true,
  type: true,
  organization: true,
  phone: true,
  phones: {
    where: { isPrimary: true },
    select: { number: true },
    take: 1,
  },
} as const;

type PickerRow = {
  id: string;
  name: string;
  type: string;
  organization: string | null;
  phone: string | null;
  phones: Array<{ number: string }>;
};

function toPickerOption(c: PickerRow): ContactPickerOption {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    organization: c.organization,
    phone: c.phones[0]?.number ?? c.phone,
  };
}

export async function listContactPickerOptions(opts?: {
  /** Float this matter's people (client + parties) to the top of
   *  the list so the typeahead surfaces them first — used when the
   *  picker opens in matter context. */
  priorityMatterId?: string;
}): Promise<ContactPickerOption[]> {
  // The matter's own people are resolved FIRST and fetched by id, so
  // the alphabetical cap below can never push them out of the list.
  const priorityIds = new Set<string>();
  if (
    opts?.priorityMatterId &&
    // A matter behind the wall must not leak its people via the
    // "priority" ordering.
    (await canAccessMatter(
      await getCurrentUserId(),
      opts.priorityMatterId
    ))
  ) {
    const [parties, matter] = await Promise.all([
      prisma.matterContact.findMany({
        where: { matterId: opts.priorityMatterId },
        select: { contactId: true },
      }),
      prisma.matter.findUnique({
        where: { id: opts.priorityMatterId },
        select: { clientId: true },
      }),
    ]);
    for (const p of parties) priorityIds.add(p.contactId);
    if (matter?.clientId) priorityIds.add(matter.clientId);
  }

  const [priority, contacts] = await Promise.all([
    priorityIds.size > 0
      ? prisma.contact.findMany({
          where: { isActive: true, id: { in: [...priorityIds] } },
          orderBy: [{ name: "asc" }],
          select: PICKER_SELECT,
        })
      : Promise.resolve([] as PickerRow[]),
    prisma.contact.findMany({
      where: { isActive: true },
      take: CONTACT_PICKER_LIMIT, // safety-net cap; priority rows are exempt
      orderBy: [{ name: "asc" }],
      select: PICKER_SELECT,
    }),
  ]);

  const first = priority.map(toPickerOption);
  const taken = new Set(first.map((c) => c.id));
  // Stable partition — matter people first, both halves still A→Z.
  return [
    ...first,
    ...contacts.filter((c) => !taken.has(c.id)).map(toPickerOption),
  ];
}

/** Merge-target option: a picker row plus the email, so two
 *  same-named records can be told apart before a hard-to-undo merge. */
export type MergeCandidateOption = ContactPickerOption & {
  email: string | null;
};

/**
 * Server-side typeahead for the merge dialog: active, not-merged
 * contacts whose name, organization or email contains the (trimmed,
 * case-insensitive) query, A-Z, at most MERGE_SEARCH_LIMIT. Searching
 * on the server means the merge target is findable no matter how big
 * the directory is (the old client-side list stopped at 500 rows).
 */
export async function searchMergeCandidates({
  query,
  excludeId,
}: {
  query: string;
  excludeId: string;
}): Promise<MergeCandidateOption[]> {
  const q = query.trim();
  if (!q) return [];
  const rows = await prisma.contact.findMany({
    where: {
      isActive: true,
      mergedIntoId: null,
      id: { not: excludeId },
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { organization: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    take: MERGE_SEARCH_LIMIT,
    orderBy: [{ name: "asc" }],
    select: { ...PICKER_SELECT, email: true },
  });
  return rows.map((c) => ({ ...toPickerOption(c), email: c.email }));
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
