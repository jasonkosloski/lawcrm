import "server-only";

/**
 * Scoped data loader for structured templates: builds the
 * `TemplateData` the render engine reads, for a matter or an intake
 * lead. Access is checked first (`assertScopeAccess`, which throws a
 * redirect/404 — never wrap it in try/catch), then every read is keyed
 * off the already-authorized record.
 */

import { prisma } from "@/lib/prisma";
import { assertScopeAccess } from "@/lib/scope-access";
import { scopeWhere, type RecordScope } from "@/lib/record-scope";
import { getCurrentFirm } from "@/lib/firm";
import { addressLines } from "@/lib/address";
import type {
  ContactData,
  CounselData,
  PartyItem,
  PartyListKey,
  PersonItem,
  SignerData,
  TemplateData,
} from "./catalog";

// ── Records request (moved from actions/document-templates.ts) ─────────

export const recordsRequestSelect = {
  id: true,
  matterId: true,
  leadId: true,
  subject: true,
  description: true,
  adHocTypeName: true,
  dateRangeStart: true,
  dateRangeEnd: true,
  responseDueDate: true,
  sentAt: true,
  type: { select: { name: true } },
  custodian: {
    select: {
      name: true,
      type: true,
      organization: true,
      email: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      zip: true,
    },
  },
} as const;

export type LoadedRecordsRequest = NonNullable<Awaited<ReturnType<typeof loadRecordsRequest>>>;

/** The request, only if it belongs to `scope` (never trust a bare id). */
export function loadRecordsRequest(scope: RecordScope, id: string) {
  return prisma.recordsRequest.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: recordsRequestSelect,
  });
}

/** Compose a contact's single-line mailing address. */
export function composeContactAddress(c: {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string | null {
  return contactAddressLines(c).join(", ") || null;
}

// ── Contact shaping ────────────────────────────────────────────────────

type ContactRow = {
  name: string;
  type: string;
  organization: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

const contactSelect = {
  name: true,
  type: true,
  organization: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  zip: true,
} as const;

/** Contact.type has no "organization" value; only courts and government
 *  bodies are always organizations. Other types (vendor, medical
 *  provider...) may be people, so they are treated as people. */
const isOrganizationType = (type: string) => type === "court" || type === "government";

function contactAddressLines(c: Pick<ContactRow, "address" | "city" | "state" | "zip">): string[] {
  return addressLines({ addressLine1: c.address, city: c.city, state: c.state, zip: c.zip });
}

function toContactData(c: ContactRow): ContactData {
  return {
    name: c.name,
    isOrganization: isOrganizationType(c.type),
    organization: c.organization,
    email: c.email,
    phone: c.phone,
    addressLines: contactAddressLines(c),
  };
}

const humanizeRole = (role: string | null): string | null => {
  const t = role?.trim().replace(/_/g, " ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
};

type MatterContactRow = {
  category: string;
  role: string | null;
  representationName: string | null;
  representationFirm: string | null;
  representationEmail: string | null;
  representationPhone: string | null;
  representationContactId: string | null;
  contactId: string;
  contact: ContactRow;
  representationContact: ContactRow | null;
};

function counselOf(mc: MatterContactRow): CounselData | null {
  if (mc.representationContact) {
    const c = mc.representationContact;
    return {
      name: c.name,
      email: c.email,
      phone: c.phone,
      addressLines: contactAddressLines(c),
    };
  }
  if (mc.representationName) {
    return {
      name: mc.representationName,
      email: mc.representationEmail,
      phone: mc.representationPhone,
      addressLines: mc.representationFirm ? [mc.representationFirm] : [],
    };
  }
  return null;
}

function toPartyItem(c: ContactRow, role: string | null, counsel: CounselData | null): PartyItem {
  return {
    name: c.name,
    isOrganization: isOrganizationType(c.type),
    email: c.email,
    phone: c.phone,
    addressLines: contactAddressLines(c),
    role: humanizeRole(role),
    counsel,
  };
}

function emptyParties(): Record<PartyListKey, PartyItem[]> {
  return {
    clients: [],
    opposing: [],
    defendants: [],
    plaintiffs: [],
    opposingCounsel: [],
    witnesses: [],
    experts: [],
  };
}

function buildParties(
  rows: MatterContactRow[],
  client: ContactRow | null,
  clientId: string | null,
): Record<PartyListKey, PartyItem[]> {
  const parties = emptyParties();
  const roleIs = (mc: MatterContactRow, r: string) => mc.role?.trim().toLowerCase() === r;
  const asParty = (mc: MatterContactRow) => toPartyItem(mc.contact, mc.role, counselOf(mc));

  if (client && !rows.some((mc) => mc.category === "client" && mc.contactId === clientId)) {
    parties.clients.push(toPartyItem(client, null, null));
  }
  const seenCounsel = new Set<string>();
  for (const mc of rows) {
    if (mc.category === "client") parties.clients.push(asParty(mc));
    if (mc.category === "opposing") {
      parties.opposing.push(asParty(mc));
      const counsel = counselOf(mc);
      if (counsel) {
        const key = mc.representationContactId ?? `name:${counsel.name.trim().toLowerCase()}`;
        if (!seenCounsel.has(key)) {
          seenCounsel.add(key);
          parties.opposingCounsel.push({
            name: counsel.name,
            isOrganization: false,
            email: counsel.email,
            phone: counsel.phone,
            addressLines: counsel.addressLines,
            role: "Opposing counsel",
            counsel: null,
          });
        }
      }
    }
    if (roleIs(mc, "defendant")) parties.defendants.push(asParty(mc));
    if (roleIs(mc, "plaintiff")) parties.plaintiffs.push(asParty(mc));
    if (mc.category === "lay_witness") parties.witnesses.push(asParty(mc));
    if (mc.category === "expert_witness") parties.experts.push(asParty(mc));
  }
  return parties;
}

// ── Loader ─────────────────────────────────────────────────────────────

export type LoadTemplateDataInput = {
  scope: RecordScope;
  signerId?: string | null;
  recipientContactId?: string | null;
  request?: LoadedRecordsRequest | null;
};

export type LoadTemplateDataResult =
  { ok: true; data: TemplateData; recordName: string } | { ok: false; error: string };

const SIGNER_ERROR = "That signer isn't on this record's team.";
const RECIPIENT_ERROR = "That recipient isn't a contact on this record.";

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  jobTitle: true,
  barNumber: true,
  isActive: true,
} as const;

type UserRow = {
  isActive?: boolean;
  name: string;
  email: string;
  phone: string | null;
  jobTitle: string;
  barNumber: string | null;
};

const toSigner = (u: UserRow): SignerData => ({
  name: u.name,
  title: u.jobTitle || null,
  barNumber: u.barNumber,
  email: u.email,
  phone: u.phone,
});

export async function loadTemplateData(
  input: LoadTemplateDataInput,
): Promise<LoadTemplateDataResult> {
  const { scope, request = null } = input;
  const userId = await assertScopeAccess(scope);
  // Defense in depth: never trust a request that belongs to another record.
  if (
    request &&
    (scope.kind === "matter"
      ? request.matterId !== scope.matterId
      : request.leadId !== scope.leadId)
  ) {
    return { ok: false, error: "Records request not found." };
  }

  const [firm, me] = await Promise.all([
    getCurrentFirm(),
    prisma.user.findUnique({
      where: { id: userId },
      select: { ...userSelect, timeZone: true },
    }),
  ]);
  if (!me) return { ok: false, error: "User not found." };

  // Record + team + party rows.
  let teamUsers: { role: string; user: UserRow & { id: string } }[];
  let recipientAllowed: (contactId: string) => boolean;
  let base: Pick<TemplateData, "matter" | "lead" | "client" | "parties" | "scope">;
  let recordName: string;

  if (scope.kind === "matter") {
    const matter = await prisma.matter.findUnique({
      where: { id: scope.matterId },
      select: {
        name: true,
        caseNumber: true,
        court: true,
        opposingParty: true,
        incidentDate: true,
        statuteOfLimitationsDate: true,
        filedDate: true,
        trialDate: true,
        clientId: true,
        practiceArea: { select: { name: true } },
        stage: { select: { name: true } },
        venue: {
          select: {
            name: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            county: true,
            state: true,
            zip: true,
            captionName: true,
          },
        },
        client: { select: contactSelect },
        contacts: {
          orderBy: { createdAt: "asc" },
          select: {
            category: true,
            role: true,
            contactId: true,
            representationContactId: true,
            representationName: true,
            representationFirm: true,
            representationEmail: true,
            representationPhone: true,
            contact: { select: contactSelect },
            representationContact: { select: contactSelect },
          },
        },
        teamMembers: {
          where: { removedAt: null },
          orderBy: { createdAt: "asc" },
          select: { role: true, user: { select: userSelect } },
        },
      },
    });
    if (!matter) return { ok: false, error: "Record not found." };
    recordName = matter.name;
    teamUsers = matter.teamMembers;
    const linked = new Set(matter.contacts.map((c) => c.contactId));
    if (matter.clientId) linked.add(matter.clientId);
    // Opposing counsel (representation contact of an opposing party) is a
    // valid recipient: letters to opposing counsel are a main use case.
    for (const c of matter.contacts) {
      if (c.category === "opposing" && c.representationContactId) {
        linked.add(c.representationContactId);
      }
    }
    recipientAllowed = (id) => linked.has(id);
    base = {
      scope: "matter",
      lead: null,
      matter: {
        name: matter.name,
        caseNumber: matter.caseNumber,
        court: matter.court,
        venueName: matter.venue?.name ?? null,
        venueAddressLine1: matter.venue?.addressLine1 ?? null,
        venueAddressLine2: matter.venue?.addressLine2 ?? null,
        venueCity: matter.venue?.city ?? null,
        venueCounty: matter.venue?.county ?? null,
        venueState: matter.venue?.state ?? null,
        venueZip: matter.venue?.zip ?? null,
        courtCaption: matter.venue?.captionName ?? matter.venue?.name ?? null,
        practiceArea: matter.practiceArea?.name ?? null,
        stage: matter.stage?.name ?? null,
        incidentDate: matter.incidentDate,
        solDate: matter.statuteOfLimitationsDate,
        filedDate: matter.filedDate,
        trialDate: matter.trialDate,
        opposingParty: matter.opposingParty,
      },
      client: matter.client ? toContactData(matter.client) : null,
      parties: buildParties(matter.contacts, matter.client, matter.clientId),
    };
  } else {
    const lead = await prisma.lead.findUnique({
      where: { id: scope.leadId },
      select: {
        name: true,
        email: true,
        phone: true,
        source: true,
        summary: true,
        location: true,
        dateOfIncident: true,
        stage: true,
        contactId: true,
        contact: { select: contactSelect },
        teamMembers: {
          orderBy: { createdAt: "asc" },
          select: { role: true, user: { select: userSelect } },
        },
      },
    });
    if (!lead) return { ok: false, error: "Record not found." };
    const c = lead.contact;
    recordName = c?.name ?? lead.name;
    teamUsers = lead.teamMembers;
    recipientAllowed = (id) => lead.contactId === id;
    base = {
      scope: "lead",
      matter: null,
      lead: {
        name: lead.name,
        incidentDate: lead.dateOfIncident,
        location: lead.location,
        source: lead.source,
        summary: lead.summary,
        stage: lead.stage,
      },
      client: {
        name: recordName,
        isOrganization: c ? isOrganizationType(c.type) : false,
        organization: c?.organization ?? null,
        email: c?.email ?? lead.email,
        phone: c?.phone ?? lead.phone,
        addressLines: c ? contactAddressLines(c) : [],
      },
      parties: emptyParties(),
    };
  }

  // Signer: the current user (default) or someone on the record's team.
  let signerUser: UserRow = me;
  if (input.signerId && input.signerId !== userId) {
    const member = teamUsers.find((t) => t.user.id === input.signerId);
    if (!member || !member.user.isActive) return { ok: false, error: SIGNER_ERROR };
    signerUser = member.user;
  }

  // Recipient: a contact already linked to this record.
  let recipient: ContactData | null = null;
  if (input.recipientContactId) {
    if (!recipientAllowed(input.recipientContactId)) {
      return { ok: false, error: RECIPIENT_ERROR };
    }
    const contact = await prisma.contact.findUnique({
      where: { id: input.recipientContactId },
      select: { ...contactSelect, isActive: true },
    });
    if (!contact || !contact.isActive) return { ok: false, error: RECIPIENT_ERROR };
    recipient = toContactData(contact);
  }

  const team: PersonItem[] = teamUsers.map((t) => ({
    name: t.user.name,
    email: t.user.email,
    phone: t.user.phone,
    role: humanizeRole(t.role),
  }));

  const data: TemplateData = {
    ...base,
    firm: {
      name: firm.name,
      addressLine1: firm.addressLine1,
      addressLine2: firm.addressLine2,
      city: firm.city,
      state: firm.state,
      zip: firm.zip,
      phone: firm.phone,
      email: firm.email,
    },
    user: { name: me.name },
    today: new Date(),
    timeZone: me.timeZone ?? null,
    signer: toSigner(signerUser),
    recipient,
    team,
    request: request
      ? {
          subject: request.subject,
          description: request.description,
          type: request.type?.name ?? request.adHocTypeName,
          dateRangeStart: request.dateRangeStart,
          dateRangeEnd: request.dateRangeEnd,
          responseDueDate: request.responseDueDate,
          sentDate: request.sentAt,
        }
      : null,
    custodian: request ? toContactData(request.custodian) : null,
  };
  return { ok: true, data, recordName };
}
