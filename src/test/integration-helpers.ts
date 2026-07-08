/**
 * Integration-test helpers.
 *
 * Two responsibilities:
 *
 *   1. `resetDb()` — wipe every table between tests so each test
 *      sees a clean DB. Order matters because of FK constraints;
 *      the order below is the reverse of the topological create
 *      order (children before parents).
 *
 *   2. Fixture builders — `seedFirm()`, `seedUser()`,
 *      `seedAdminRole()`, `seedMatter()` etc. — that create the
 *      smallest reasonable rows for a test to do its work. Every
 *      builder returns the row's id (or shape) so the test can
 *      thread it into action calls.
 *
 * The module imports the project's prisma singleton — which by
 * the time integration tests run is pointed at the test DB via
 * `DATABASE_URL` set in `integration-setup.ts`. So all fixtures
 * land in the test DB, not the dev DB.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** All Prisma model table names, in dependency order — children
 *  first so we can DELETE without FK violations. Keep this list
 *  in sync with @@map() entries in `prisma/schema.prisma`. */
const TABLES_IN_DELETE_ORDER = [
  // Settlement chain (children of Settlement)
  "settlement_approvals",
  "settlement_liens",
  // Invoice payment chain (children of Invoice / TrustTransaction)
  "invoice_payments",
  "trust_transactions",
  // Time + Expense pin to invoices
  "expenses",
  "time_entries",
  "invoices",
  "settlements",
  // Calendar / messaging — drop attendees + items before parents
  // (calendar_event_syncs references BOTH calendar_events and
  // email_accounts, so it goes before either parent).
  "calendar_event_syncs",
  "calendar_attendees",
  "calendar_events",
  "email_attachments",
  "email_messages",
  "email_threads",
  "email_labels",
  "email_accounts",
  "messenger_items",
  "messenger_threads",
  "messenger_accounts",
  // Notes + reactions + reads
  "note_reactions",
  "note_reads",
  "notes",
  // Tasks + deadlines reference matters/users
  "tasks",
  "deadlines",
  // Documents + evidence — documents before folders (Document.folderId
  // is SetNull, but deleting in this order avoids the null churn).
  "evidence_syncs",
  "flagged_moments",
  "evidence",
  "documents",
  "document_folders",
  // Template library rows reference users (createdById); drop
  // before users.
  "document_templates",
  // Matter membership
  "matter_team_members",
  "matter_contacts",
  "user_matter_pins",
  // Timer scratch rows reference user + matter; drop before both.
  "timer_sessions",
  "matters",
  // Lookups + lifecycle
  "leads",
  "contact_phones",
  "contacts",
  "matter_stages",
  "practice_areas",
  // Auth / role membership
  "user_roles",
  "role_permissions",
  "roles",
  "verification_tokens",
  "accounts",
  // Activity logs reference users/matters
  "activity_logs",
  "automations",
  // Per-user notifications reference user + matter; drop before users.
  "notifications",
  // Per-user saved searches reference users; drop before users.
  "saved_searches",
  // Users + firm at the bottom
  "users",
  "firms",
];

/** Truncate every table. SQLite-friendly via `DELETE FROM` (it
 *  doesn't support TRUNCATE). Wrapped in a transaction so a
 *  partial failure leaves no half-cleaned state. */
export async function resetDb(): Promise<void> {
  await prisma.$transaction(
    TABLES_IN_DELETE_ORDER.map((table) =>
      prisma.$executeRawUnsafe(`DELETE FROM ${table}`)
    )
  );
}

// ── Fixture builders ────────────────────────────────────────────────────

/** Minimal Firm + the two system Roles every firm has. Returns
 *  the firm + admin role + default role ids so callers can wire
 *  users to them. */
export async function seedFirm(opts?: {
  name?: string;
}): Promise<{ firmId: string; adminRoleId: string; defaultRoleId: string }> {
  const firm = await prisma.firm.create({
    data: { name: opts?.name ?? "Test Firm LLC" },
    select: { id: true },
  });
  const [adminRole, defaultRole] = await prisma.$transaction([
    prisma.role.create({
      data: {
        firmId: firm.id,
        name: "Admin",
        isSystem: true,
        description: "Test admin role",
      },
      select: { id: true },
    }),
    prisma.role.create({
      data: {
        firmId: firm.id,
        name: "default",
        isSystem: true,
        description: "Test default role",
      },
      select: { id: true },
    }),
  ]);
  return {
    firmId: firm.id,
    adminRoleId: adminRole.id,
    defaultRoleId: defaultRole.id,
  };
}

/** A single user, optionally tied to roles. */
export async function seedUser(opts: {
  firmId: string;
  email?: string;
  name?: string;
  initials?: string;
  jobTitle?: string;
  isActive?: boolean;
  roleIds?: string[];
}): Promise<{ userId: string }> {
  const user = await prisma.user.create({
    data: {
      firmId: opts.firmId,
      email: opts.email ?? `test-${Math.random().toString(36).slice(2, 8)}@example.com`,
      name: opts.name ?? "Test User",
      initials: opts.initials ?? "TU",
      jobTitle: opts.jobTitle ?? "Attorney",
      isActive: opts.isActive ?? true,
    },
    select: { id: true },
  });
  if (opts.roleIds && opts.roleIds.length > 0) {
    await prisma.userRole.createMany({
      data: opts.roleIds.map((roleId) => ({
        userId: user.id,
        roleId,
      })),
    });
  }
  return { userId: user.id };
}

/** A practice area + a single active "Intake" stage on it. */
export async function seedPracticeArea(opts?: {
  name?: string;
  hasStatuteOfLimitations?: boolean;
}): Promise<{ areaId: string; stageId: string }> {
  const area = await prisma.practiceArea.create({
    data: {
      name: opts?.name ?? `Test Area ${Math.random().toString(36).slice(2, 6)}`,
      hasStatuteOfLimitations: opts?.hasStatuteOfLimitations ?? false,
    },
    select: { id: true },
  });
  const stage = await prisma.matterStage.create({
    data: {
      practiceAreaId: area.id,
      name: "Intake",
      order: 0,
    },
    select: { id: true },
  });
  return { areaId: area.id, stageId: stage.id };
}

/** A matter wired up to a (seeded) practice area + lead user. */
export async function seedMatter(opts: {
  practiceAreaId: string;
  stageId: string;
  leadUserId: string;
  name?: string;
  opposingParty?: string | null;
  opposingFirm?: string | null;
}): Promise<{ matterId: string }> {
  const matter = await prisma.matter.create({
    data: {
      name: opts.name ?? "Test Matter",
      practiceAreaId: opts.practiceAreaId,
      stageId: opts.stageId,
      feeStructure: "hourly",
      opposingParty: opts.opposingParty ?? null,
      opposingFirm: opts.opposingFirm ?? null,
      teamMembers: {
        create: { userId: opts.leadUserId, role: "lead" },
      },
    },
    select: { id: true },
  });
  return { matterId: matter.id };
}

/** A billable, un-invoiced TimeEntry. Scope with `matterId` (the
 *  usual case) OR `leadId` (intake time) — exactly one, per the
 *  TimeEntry scope invariant; the helper doesn't police it so tests
 *  can also seed deliberately-broken rows. */
export async function seedTimeEntry(opts: {
  matterId?: string | null;
  leadId?: string | null;
  userId: string;
  hours?: number;
  rate?: number;
  amount?: number;
  status?: string;
  billable?: boolean;
  invoiceId?: string | null;
}): Promise<{ timeEntryId: string }> {
  const hours = opts.hours ?? 1;
  const rate = opts.rate ?? 250;
  const amount = opts.amount ?? hours * rate;
  const row = await prisma.timeEntry.create({
    data: {
      matterId: opts.matterId ?? null,
      leadId: opts.leadId ?? null,
      userId: opts.userId,
      date: new Date(),
      hours,
      activity: "Test work",
      rate: new Prisma.Decimal(rate),
      amount: new Prisma.Decimal(amount),
      billable: opts.billable ?? true,
      status: opts.status ?? "billable",
      invoiceId: opts.invoiceId ?? null,
    },
    select: { id: true },
  });
  return { timeEntryId: row.id };
}

/** A billable, un-invoiced Expense on the given matter. */
export async function seedExpense(opts: {
  matterId: string;
  amount?: number;
  billable?: boolean;
  invoiceId?: string | null;
}): Promise<{ expenseId: string }> {
  const row = await prisma.expense.create({
    data: {
      matterId: opts.matterId,
      date: new Date(),
      description: "Test expense",
      category: "filing_fee",
      amount: new Prisma.Decimal(opts.amount ?? 100),
      billable: opts.billable ?? true,
      invoiceId: opts.invoiceId ?? null,
    },
    select: { id: true },
  });
  return { expenseId: row.id };
}

/** A standalone Contact. Type defaults to "client"; pass
 *  `"opposing_counsel"` etc. for opposing-side records. */
export async function seedContact(opts?: {
  name?: string;
  email?: string | null;
  organization?: string | null;
  type?: string;
  isActive?: boolean;
}): Promise<{ contactId: string }> {
  const c = await prisma.contact.create({
    data: {
      name: opts?.name ?? "Test Contact",
      email: opts?.email ?? null,
      organization: opts?.organization ?? null,
      type: opts?.type ?? "client",
      isActive: opts?.isActive ?? true,
    },
    select: { id: true },
  });
  return { contactId: c.id };
}

/** Pin a contact to a matter as opposing-side party. */
export async function seedMatterContact(opts: {
  matterId: string;
  contactId: string;
  category: string;
}): Promise<{ matterContactId: string }> {
  const mc = await prisma.matterContact.create({
    data: {
      matterId: opts.matterId,
      contactId: opts.contactId,
      category: opts.category,
    },
    select: { id: true },
  });
  return { matterContactId: mc.id };
}

/** A DocumentFolder in a matter's tree. Null/omitted parentId =
 *  matter root. */
export async function seedDocumentFolder(opts: {
  matterId: string;
  name: string;
  parentId?: string | null;
  order?: number;
}): Promise<{ folderId: string }> {
  const folder = await prisma.documentFolder.create({
    data: {
      matterId: opts.matterId,
      parentId: opts.parentId ?? null,
      name: opts.name,
      order: opts.order ?? 0,
    },
    select: { id: true },
  });
  return { folderId: folder.id };
}

/** A Document row, optionally filed in a folder. No file blob —
 *  folder tests care about rows, not bytes. Pass `contentType`
 *  (e.g. "video/mp4") for media-renderer-dependent tests
 *  (flagged moments). */
export async function seedDocument(opts: {
  matterId: string;
  name?: string;
  folderId?: string | null;
  uploadedBy?: string | null;
  contentType?: string | null;
}): Promise<{ documentId: string }> {
  const doc = await prisma.document.create({
    data: {
      matterId: opts.matterId,
      folderId: opts.folderId ?? null,
      name: opts.name ?? "Test Document.pdf",
      category: "other",
      source: "upload",
      uploadedBy: opts.uploadedBy ?? null,
      contentType: opts.contentType ?? null,
    },
    select: { id: true },
  });
  return { documentId: doc.id };
}

/** A FlaggedMoment on a document — evidence-review fixture.
 *  Defaults to a time anchor at 0:30; pass `pageNumber` / `quote`
 *  for the other anchor kinds (timeSeconds then defaults to null),
 *  or an explicit `timeSeconds: null` alone for an anchorless flag. */
export async function seedFlaggedMoment(opts: {
  documentId: string;
  flaggedById: string;
  timeSeconds?: number | null;
  endSeconds?: number | null;
  pageNumber?: number | null;
  quote?: string | null;
  category?: string;
  description?: string;
}): Promise<{ flagId: string }> {
  const timeSeconds =
    opts.timeSeconds !== undefined
      ? opts.timeSeconds
      : opts.pageNumber != null || opts.quote != null
        ? null
        : 30;
  const flag = await prisma.flaggedMoment.create({
    data: {
      documentId: opts.documentId,
      timeSeconds,
      endSeconds: opts.endSeconds ?? null,
      pageNumber: opts.pageNumber ?? null,
      quote: opts.quote ?? null,
      category: opts.category ?? "emphasis",
      description: opts.description ?? "Test flagged moment",
      flaggedById: opts.flaggedById,
    },
    select: { id: true },
  });
  return { flagId: flag.id };
}

/** A CalendarEvent — defaults to a matterless personal meeting an
 *  hour long. Pass `attendees` to shape the Google-calendar-sync
 *  cancellation-rule matrix (userId XOR contactId per row). */
export async function seedCalendarEvent(opts: {
  createdById?: string | null;
  matterId?: string | null;
  title?: string;
  type?: string;
  visibility?: string;
  startTime?: Date;
  endTime?: Date;
  isAllDay?: boolean;
  attendees?: Array<{
    userId?: string | null;
    contactId?: string | null;
    name: string;
    email?: string | null;
  }>;
}): Promise<{ eventId: string }> {
  const startTime = opts.startTime ?? new Date("2026-08-01T15:00:00.000Z");
  const endTime =
    opts.endTime ?? new Date(startTime.getTime() + 60 * 60 * 1000);
  const event = await prisma.calendarEvent.create({
    data: {
      createdById: opts.createdById ?? null,
      matterId: opts.matterId ?? null,
      title: opts.title ?? "Test Event",
      type: opts.type ?? "meeting",
      visibility: opts.visibility ?? "default",
      startTime,
      endTime,
      isAllDay: opts.isAllDay ?? false,
      ...(opts.attendees && opts.attendees.length > 0
        ? {
            attendees: {
              create: opts.attendees.map((a) => ({
                userId: a.userId ?? null,
                contactId: a.contactId ?? null,
                name: a.name,
                email: a.email ?? null,
              })),
            },
          }
        : {}),
    },
    select: { id: true },
  });
  return { eventId: event.id };
}

/** A Lead. Optional contactId joins it to a Contact for the
 *  matcher's identity-fingerprint pull. */
export async function seedLead(opts?: {
  name?: string;
  email?: string | null;
  contactId?: string | null;
}): Promise<{ leadId: string }> {
  const lead = await prisma.lead.create({
    data: {
      name: opts?.name ?? "Test Lead",
      email: opts?.email ?? null,
      contactId: opts?.contactId ?? null,
    },
    select: { id: true },
  });
  return { leadId: lead.id };
}
