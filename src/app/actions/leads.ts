/**
 * Lead intake server actions — create, convert and decline.
 *
 *   - createLead: the New intake form. Links the person to an existing
 *     Contact (picked in the form, or matched by email) or creates
 *     one, writes the Lead, and runs the conflict matcher immediately
 *     so a conflict surfaces before anyone invests time. Gated by
 *     intake.create.
 *
 * v1 keeps both flows minimal:
 *   - convertLeadToMatter: create a Matter from the lead's basic
 *     details + a Contact for the lead person, link them, mark the
 *     lead as converted, redirect to the new matter. When the target
 *     area tracks a statute of limitations, the lead's dateOfIncident
 *     becomes the matter's incidentDate, the SOL date is auto-computed
 *     from the area's statute period, and the auto-managed critical
 *     SOL Deadline is created — same malpractice guard as the direct
 *     create path in matters.ts. Intake time entries logged on the
 *     lead (TimeEntry.leadId) are re-homed onto the new matter inside
 *     the same transaction (matterId set, leadId cleared) and the
 *     roll-forward is activity-logged on the matter. Intake notes
 *     (Note.leadId), tasks (Task.leadId) and events
 *     (CalendarEvent.leadId) re-home the same way.
 *   - declineLead: capture an optional reason, mark stage "declined".
 *     Gated by intake.decline + written to the ActivityLog, matching
 *     the conflict-check siblings — declining removes a lead from the
 *     active intake queue, so who/why must be auditable.
 *
 * Practice-area-specific automations (CGIA notice deadlines for §1983,
 * HUD response for FHA, etc.) are explicit follow-ups in
 * docs/features/intake.md — this action just creates the matter so the user
 * can take it from there. The lead's existing data (summary, location,
 * incident date, injuries) flows into the new matter's description so
 * nothing gets lost.
 */

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { computeSolDate, SOL_SOURCE_TYPE, toSolPeriod } from "@/lib/sol";
import { dateOnlyKey, parseDateOnly } from "@/lib/format-date";
import { runConflictMatcher } from "@/lib/conflict-check";
import type { NewIntakeFormState } from "@/lib/new-intake-form";
import { rehomeLeadDocuments } from "@/lib/lead-documents";
import {
  feeMakesExpense,
  recordsFeeDescription,
  recordsFeeExpenseData,
} from "@/lib/records-requests/fee-expense";
import { applyAutoDefaults, describeDefaults } from "@/lib/automations/apply";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import type {
  ConvertLeadFormState,
  DeclineLeadFormState,
} from "@/lib/lead-conversion-form";
import { LEAD_SOURCES, type LeadStage } from "@/lib/constants/lead-stage";

// Stage writes/compares below are typed against the centralized
// LeadStage union (src/lib/constants/lead-stage.ts) so a typo can't
// silently misclassify a lead.
const CONVERTED = "converted" satisfies LeadStage;
const DECLINED = "declined" satisfies LeadStage;

const ALREADY_CONVERTED_ERROR = "Lead is already converted to a matter.";
const ALREADY_DECLINED_ERROR = "Lead is already declined.";
const CONFLICT_BLOCKS_CONVERSION_ERROR =
  "The conflict check found a conflict. Resolve it, or have someone authorized record an override on the lead's Overview, before converting.";
const DECLINED_BEFORE_CONVERT_ERROR =
  "This lead was declined. Reopen it before converting.";
const DECLINE_AFTER_CONVERT_ERROR =
  "Lead is already converted — can't decline a matter that exists.";

/** Thrown inside the conversion transaction when the stage claim
 *  matches no row (the lead changed stage after we read it), so the
 *  whole transaction rolls back and the caller maps it to a form
 *  error based on the lead's current stage. */
class LeadClaimLostError extends Error {}

// ── Convert ─────────────────────────────────────────────────────────────

// ── Create (New intake form) ────────────────────────────────────────────

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

const createLeadSchema = z
  .object({
    /** Existing Contact to link; "" = create (or email-match) one. */
    contactId: z.string().trim().optional().or(z.literal("")),
    name: z.string().trim().max(200).optional().or(z.literal("")),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid email")
      .max(200)
      .optional()
      .or(z.literal("")),
    phone: optionalText(40),
    source: z.enum(LEAD_SOURCES).optional().or(z.literal("")),
    sourceDetail: optionalText(200),
    summary: optionalText(4000),
    location: optionalText(200),
    dateOfIncident: z.string().trim().optional().or(z.literal("")),
    injuries: optionalText(2000),
    priorCounsel: z.literal("on").optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.contactId && !v.name) {
      ctx.addIssue({ code: "custom", path: ["name"], message: "Enter the person's name" });
    }
  });

/**
 * New intake. Resolves the person to a Contact — the one picked in
 * the form, else an active contact with the same email (so a repeat
 * caller becomes one record, the same rule conversion relies on),
 * else a new "client" Contact — then writes the Lead and runs the
 * conflict matcher before redirecting to it.
 */
export async function createLead(
  _prev: NewIntakeFormState,
  formData: FormData
): Promise<NewIntakeFormState> {
  const actorId = await requirePermission("intake.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = createLeadSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors, values: raw };
  }
  const d = parsed.data;

  let dateOfIncident: Date | null = null;
  if (d.dateOfIncident) {
    dateOfIncident = parseDateOnly(d.dateOfIncident);
    if (!dateOfIncident) {
      return { status: "error", errors: { dateOfIncident: ["Enter a valid date"] }, values: raw };
    }
  }

  const contactSelect = { id: true, name: true, email: true, phone: true, organization: true } as const;
  const activeContact = { isActive: true, mergedIntoId: null } as const;
  let contact = d.contactId
    ? await prisma.contact.findFirst({ where: { id: d.contactId, ...activeContact }, select: contactSelect })
    : null;
  if (d.contactId && !contact) {
    return { status: "error", errors: { name: ["That contact is no longer available — search again"] }, values: raw };
  }
  if (!contact && d.email) {
    contact = await prisma.contact.findFirst({
      where: { email: { equals: d.email, mode: "insensitive" }, ...activeContact },
      orderBy: { createdAt: "asc" },
      select: contactSelect,
    });
  }

  const lead = await prisma.$transaction(async (tx) => {
    const person =
      contact ??
      (await tx.contact.create({
        data: {
          name: d.name!,
          email: d.email || null,
          phone: d.phone || null, // denormalized — mirrors the primary ContactPhone
          type: "client",
          ...(d.phone
            ? { phones: { create: { label: "Primary", number: d.phone, isPrimary: true, order: 0 } } }
            : {}),
        },
        select: contactSelect,
      }));
    return tx.lead.create({
      data: {
        contactId: person.id,
        // Legacy mirrors (Lead.name/email/phone) — prefer the contact.
        name: person.name,
        email: person.email,
        phone: person.phone,
        source: d.source || null,
        sourceDetail: d.sourceDetail || null,
        summary: d.summary || null,
        location: d.location || null,
        dateOfIncident,
        injuries: d.injuries || null,
        priorCounsel: d.priorCounsel === "on",
      },
      select: { id: true, name: true, contactId: true, contact: { select: contactSelect } },
    });
  });

  // Conflict check on save — the same matcher (and self-match rule)
  // as the conflict-check card's "Run check".
  const conflict = await runConflictMatcher({
    name: lead.contact?.name ?? lead.name,
    email: lead.contact?.email ?? null,
    organization: lead.contact?.organization ?? null,
    ownContactId: lead.contactId,
  });
  await prisma.lead.update({
    where: { id: lead.id },
    data: { conflictCheck: conflict.severity, conflictCheckedAt: new Date() },
  });

  await logActivity({
    matterId: null,
    userId: actorId,
    type: "filing",
    title: `New intake: ${lead.name}`,
    detail: `lead ${lead.id}: ${contact ? "linked to existing contact" : "new contact"} · conflict check ${conflict.severity}`,
  });

  revalidatePath("/intake");
  revalidatePath("/", "layout"); // sidebar "active leads" badge
  redirect(`/intake/${lead.id}`);
}

const convertSchema = z.object({
  practiceAreaId: z.string().trim().min(1, "Practice area is required"),
  stageId: z.string().trim().min(1, "Initial stage is required"),
  name: z.string().trim().min(1, "Matter name is required").max(200),
  feeStructure: z
    .enum(["contingent", "hourly", "flat", "hybrid", "pro_bono"])
    .default("contingent"),
});

/**
 * Builds a description string for the new matter that preserves the
 * lead-intake context the user already captured. Each line is only
 * included if the lead actually has that field — no empty headers.
 */
function composeMatterDescription(lead: {
  summary: string | null;
  location: string | null;
  dateOfIncident: Date | null;
  injuries: string | null;
  source: string | null;
  sourceDetail: string | null;
}): string {
  const lines: string[] = [];
  if (lead.summary) lines.push(lead.summary);
  if (lead.location) lines.push(`Incident location: ${lead.location}`);
  if (lead.dateOfIncident) {
    lines.push(
      `Date of incident: ${dateOnlyKey(lead.dateOfIncident)}`
    );
  }
  if (lead.injuries) lines.push(`Injuries: ${lead.injuries}`);
  if (lead.source) {
    lines.push(
      `Source: ${lead.source}${lead.sourceDetail ? ` · ${lead.sourceDetail}` : ""}`
    );
  }
  return lines.join("\n\n");
}

export async function convertLeadToMatter(
  leadId: string,
  _prev: ConvertLeadFormState,
  formData: FormData
): Promise<ConvertLeadFormState> {
  // Conversion creates a Matter row — same gate as the direct
  // create path so the rule is single: "creating a matter requires
  // matters.create, regardless of the entry point."
  await requirePermission("matters.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = convertSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    return {
      status: "error",
      errors: { _form: ["Lead no longer exists"] },
    };
  }
  if (lead.stage === CONVERTED) {
    return {
      status: "error",
      errors: { _form: [ALREADY_CONVERTED_ERROR] },
    };
  }

  // Validate the picked stage actually belongs to the picked area —
  // the form picker enforces this client-side, but the server is the
  // source of truth. Inactive areas / stages are rejected too: the
  // direct create path (resolveAreaAndStage in matters.ts) forbids
  // retired targets, and conversion must not be a back door into them
  // via a stale or crafted form post.
  const [area, stage] = await Promise.all([
    prisma.practiceArea.findUnique({
      where: { id: parsed.data.practiceAreaId },
      // defaultBillingMode snapshots onto the new Matter so the
      // billing tab shows the right flow from day one. The SOL pair
      // drives incidentDate / SOL-date carry-over from the lead.
      select: {
        id: true,
        color: true,
        isActive: true,
        defaultBillingMode: true,
        hasStatuteOfLimitations: true,
        statutePeriodAmount: true,
        statutePeriodUnit: true,
      },
    }),
    prisma.matterStage.findUnique({
      where: { id: parsed.data.stageId },
      select: { id: true, practiceAreaId: true, isActive: true },
    }),
  ]);
  if (!area || !area.isActive) {
    return {
      status: "error",
      errors: { practiceAreaId: ["Practice area is not available"] },
    };
  }
  if (!stage || stage.practiceAreaId !== area.id) {
    return {
      status: "error",
      errors: { stageId: ["Stage doesn't belong to the selected area"] },
    };
  }
  if (!stage.isActive) {
    return {
      status: "error",
      errors: { stageId: ["Stage is no longer active"] },
    };
  }

  // Conflict gate (ADR-050). Re-run the matcher NOW rather than trust
  // the stored status: a contact flagged or a party added since the
  // last check must still stop the conversion. A recorded override
  // (justified, intake.conflict_check.override) stands, exactly as a
  // re-run of the check keeps it. Messages carry counts only; match
  // details can name restricted matters.
  const identity = lead.contactId
    ? await prisma.contact.findUnique({
        where: { id: lead.contactId },
        select: { name: true, email: true, organization: true },
      })
    : null;
  const conflict = await runConflictMatcher({
    name: identity?.name ?? lead.name,
    email: identity?.email ?? lead.email,
    organization: identity?.organization ?? null,
    ownContactId: lead.contactId,
  });
  const overridden = lead.conflictCheck === "override";
  if (!overridden && conflict.severity !== lead.conflictCheck) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { conflictCheck: conflict.severity, conflictCheckedAt: new Date() },
    });
  }
  if (!overridden && conflict.severity === "conflict") {
    return {
      status: "error",
      errors: { _form: [CONFLICT_BLOCKS_CONVERSION_ERROR] },
    };
  }
  const warningsReviewed = raw.conflictWarningsReviewed === "true";
  if (!overridden && conflict.severity === "warn" && !warningsReviewed) {
    return { status: "error", conflictWarnings: conflict.matches.length };
  }
  const conflictOutcome = overridden
    ? "override"
    : conflict.severity === "warn"
      ? "warn (reviewed)"
      : "clear";

  const [userId, tz] = await Promise.all([
    getCurrentUserId(),
    getCurrentUserTimeZone(),
  ]);
  const description = composeMatterDescription(lead);

  // SOL carry-over — same rules as the direct create path: persist
  // the incident date only when the area tracks SOL (so a lead
  // converted into a non-SOL area doesn't leave a dangling date),
  // and auto-compute the SOL date from the area's configured period.
  // The lead form has no manual SOL-date override; per-matter
  // overrides happen on the matter edit form after conversion.
  const incidentDate = area.hasStatuteOfLimitations
    ? lead.dateOfIncident
    : null;
  const solDate = computeSolDate(
    incidentDate,
    toSolPeriod(area.statutePeriodAmount, area.statutePeriodUnit)
  );

  // Single transaction so a half-converted lead can't exist.
  const result = await prisma.$transaction(async (tx) => {
    // Claim the lead FIRST, with a predicate on the exact stage we
    // read. That read is outside the transaction, so a double-click /
    // second tab / second attorney could pass the checks above; this
    // conditional write is the real guard. Under READ COMMITTED a
    // concurrent claimer blocks on this row lock, re-evaluates the
    // predicate, and matches 0 rows. A decline that committed after
    // our read also fails the predicate, so it is never overwritten.
    // (Converting a lead that was ALREADY declined when read stays
    // allowed, and clears the stale decline reason so a converted lead
    // never carries one.) convertedMatterId is set once the matter
    // exists.
    const claimed = await tx.lead.updateMany({
      where: { id: leadId, stage: lead.stage },
      data: { stage: CONVERTED, declineReason: null },
    });
    if (claimed.count === 0) throw new LeadClaimLostError();

    // Lock the lead's records requests BEFORE re-homing tasks/documents
    // (request rows first, then task rows: the order every records
    // helper uses) and before reading them for fee booking. A lead fee
    // save in flight either commits first (and is booked below) or waits
    // and then sees the request on the matter.
    await tx.$queryRaw`SELECT id FROM "records_requests" WHERE "leadId" = ${leadId} FOR UPDATE`;

    // Every lead is attached to a Contact (Lead.contactId) — same
    // shape as Matter.clientId. The Patel-style "find by email"
    // dance lives in the create-lead flow now (so prior intakes for
    // the same person coalesce up front), not at conversion time.
    //
    // For un-backfilled rows that still lack a contactId, fall back
    // to the legacy create-on-conversion path so old data doesn't
    // block conversion. This branch can be deleted once the legacy
    // text columns get retired.
    let clientContactId = lead.contactId;
    if (!clientContactId) {
      const created = await tx.contact.create({
        data: {
          name: lead.name,
          type: "client",
          email: lead.email,
          phone: lead.phone, // denormalized — kept in sync with the primary ContactPhone
        },
        select: { id: true },
      });
      clientContactId = created.id;
      // Mirror the lead's phone as a primary ContactPhone row so it
      // matches what the parties composer creates.
      if (lead.phone) {
        await tx.contactPhone.create({
          data: {
            contactId: created.id,
            label: "Primary",
            number: lead.phone,
            isPrimary: true,
            order: 0,
          },
        });
      }
      // Heal the lead row so the next read sees the FK populated.
      await tx.lead.update({
        where: { id: leadId },
        data: { contactId: created.id },
      });
    }

    const matter = await tx.matter.create({
      data: {
        name: parsed.data.name,
        practiceAreaId: area.id,
        stageId: stage.id,
        feeStructure: parsed.data.feeStructure,
        // Snapshot the area's default — same pattern as the direct
        // matter-create path.
        billingMode: area.defaultBillingMode,
        color: area.color,
        description: description || null,
        clientId: clientContactId,
        incidentDate,
        statuteOfLimitationsDate: solDate,
        // Invariant shared with createMatter / updateMatter: whenever
        // a matter has a client, that contact is also a MatterContact
        // with category="client" so the Parties tab shows them.
        contacts: {
          create: { contactId: clientContactId, category: "client" },
        },
      },
      select: { id: true },
    });

    // Auto-create the critical SOL Deadline when a date computed.
    // The matter is brand-new inside this transaction, so there's no
    // existing auto row to reconcile — a conditional create is the
    // whole of syncMatterSolDeadline's contract here. Later edits
    // (updateMatter / setMatterSolSatisfied in matters.ts) find this
    // row by SOL_SOURCE_TYPE and keep it in sync.
    if (solDate) {
      await tx.deadline.create({
        data: {
          matterId: matter.id,
          title: "Statute of limitations",
          dueDate: solDate,
          kind: "critical",
          sourceType: SOL_SOURCE_TYPE,
          // Converting user is the lead attorney (set just below) —
          // same owner default as the direct create path.
          ownerId: userId,
          status: "open",
        },
      });
    }

    // Lead attorney = the user doing the conversion. Solo-friendly
    // default; multi-user firms can re-assign on the matter detail
    // page once the team editor lands.
    await tx.matterTeamMember.create({
      data: { matterId: matter.id, userId, role: "lead" },
    });

    // Auto-pin so the new matter appears in the user's sidebar.
    await tx.userMatterPin.create({
      data: { userId, matterId: matter.id },
    });

    // Roll intake time forward: every lead-scoped entry (evaluation
    // calls, conflict checks) re-homes onto the new matter — matterId
    // set, leadId cleared in one write, so the exactly-one-of scope
    // invariant holds for every row throughout. Hours / flags /
    // amounts are untouched: the entry is the same work, it just
    // gained a matter. Must happen before the lead could ever be
    // deleted — Lead→TimeEntry cascades.
    const carried = await tx.timeEntry.updateMany({
      where: { leadId },
      data: { matterId: matter.id, leadId: null },
    });
    // Intake notes roll forward the same way (Lead→Note cascades
    // too). Replies, reads and reactions key off the note id, so
    // threads arrive on the matter's Notes tab intact.
    const carriedNotes = await tx.note.updateMany({
      where: { leadId },
      data: { matterId: matter.id, leadId: null },
    });
    // Intake tasks and events too. An event moves under the matter's
    // visibility rules from here on (the team now sees its details);
    // its attendees stay as they were.
    const carriedTasks = await tx.task.updateMany({
      where: { leadId },
      data: { matterId: matter.id, leadId: null },
    });
    const carriedEvents = await tx.calendarEvent.updateMany({
      where: { leadId },
      data: { matterId: matter.id, leadId: null },
    });

    // Mark lead converted so it leaves the active intake queue.
    await tx.lead.update({
      where: { id: leadId },
      data: {
        stage: CONVERTED,
        convertedMatterId: matter.id,
      },
    });

    // Firm-configured defaults (Settings → Automations) — the same
    // matter_created trigger the New-matter form fires. After the
    // team insert above so "assign to lead" tasks + deadline owners
    // resolve to the converting attorney.
    const defaults = await applyAutoDefaults(tx, {
      matterId: matter.id,
      practiceAreaId: area.id,
      trigger: "matter_created",
      tz,
    });

    // Intake documents + folders roll forward last. Defensive: in case the
    // new matter already has root folders, a colliding lead folder is
    // suffixed rather than duplicated.
    const carriedDocumentCount = await rehomeLeadDocuments(tx, leadId, matter.id);

    // Records requests roll forward after tasks/documents (their follow-up
    // tasks and letters already moved). The lead row is write-locked by
    // the claim above, matching the uploads' lead-then-request lock order.
    const requests = await tx.recordsRequest.findMany({
      where: { leadId },
      select: {
        id: true,
        feeAmount: true,
        feePaidAt: true,
        expenseId: true,
        adHocTypeName: true,
        custodian: { select: { name: true } },
        type: { select: { name: true } },
      },
    });
    await tx.recordsRequest.updateMany({
      where: { leadId },
      data: { matterId: matter.id, leadId: null },
    });
    let carriedRecordsFeeCount = 0;
    for (const r of requests) {
      if (r.expenseId || !r.feePaidAt || !feeMakesExpense(r.feeAmount, r.feePaidAt)) {
        continue;
      }
      const e = await tx.expense.create({
        data: recordsFeeExpenseData({
          matterId: matter.id,
          loggedBy: userId,
          feePaidAt: r.feePaidAt,
          feeAmount: r.feeAmount!,
          description: recordsFeeDescription({
            custodianName: r.custodian.name,
            typeName: r.type?.name ?? null,
            adHocTypeName: r.adHocTypeName,
          }),
        }),
        select: { id: true },
      });
      await tx.recordsRequest.update({
        where: { id: r.id },
        data: { expenseId: e.id },
      });
      carriedRecordsFeeCount++;
    }

    return {
      matterId: matter.id,
      carriedCount: carried.count,
      carriedNoteCount: carriedNotes.count,
      carriedTaskCount: carriedTasks.count,
      carriedEventCount: carriedEvents.count,
      carriedDocumentCount,
      carriedRequestCount: requests.length,
      carriedRecordsFeeCount,
      defaults,
    };
  }).catch((err: unknown) => {
    // Lost the claim race — surfaced below as a form error. Anything
    // else is a real failure and must propagate.
    if (err instanceof LeadClaimLostError) return null;
    throw err;
  });
  if (!result) {
    const current = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { stage: true },
    });
    const message = !current
      ? "Lead no longer exists"
      : current.stage === CONVERTED
        ? ALREADY_CONVERTED_ERROR
        : current.stage === DECLINED
          ? DECLINED_BEFORE_CONVERT_ERROR
          : "This lead changed while you were converting it. Reload and try again.";
    return { status: "error", errors: { _form: [message] } };
  }

  const {
    matterId,
    carriedCount,
    carriedNoteCount,
    carriedTaskCount,
    carriedEventCount,
    carriedDocumentCount,
    carriedRequestCount,
    carriedRecordsFeeCount,
    defaults,
  } = result;

  // The matter's timeline starts with where it came from.
  await logActivity({
    matterId,
    userId,
    type: "automation",
    title: `Converted from lead: ${lead.name}`,
    detail: lead.source ? `Source: ${lead.source}` : null,
  });
  const defaultsLine = describeDefaults(defaults);
  if (defaultsLine) {
    await logActivity({
      matterId,
      userId,
      type: "automation",
      title: defaultsLine,
    });
  }

  // The conflict outcome the conversion passed on, on the matter's
  // timeline. A plain "clear" stays silent; a reviewed warning or a
  // standing override is what compliance review asks about.
  if (conflictOutcome !== "clear") {
    await logActivity({
      matterId,
      userId,
      type: "automation",
      title: `Converted with conflict check: ${conflictOutcome}`,
      detail: `lead ${leadId}: ${lead.name} — ${
        overridden
          ? "authorized override on the lead"
          : `${conflict.matches.length} possible conflict${conflict.matches.length === 1 ? "" : "s"} acknowledged`
      }`,
    });
  }

  // Audit trail for the roll-forward — the matter's timeline should
  // say where its pre-conversion hours came from. Outside the
  // transaction on purpose: logActivity is fire-and-forget by
  // contract and must never roll back a completed conversion.
  if (carriedCount > 0) {
    await logActivity({
      matterId,
      userId,
      type: "time_entry",
      title: `${carriedCount} intake time ${carriedCount === 1 ? "entry" : "entries"} carried forward`,
      detail: `Logged on the lead before conversion · ${lead.name}`,
    });
  }
  if (carriedNoteCount > 0) {
    await logActivity({
      matterId,
      userId,
      type: "note",
      title: `${carriedNoteCount} intake ${carriedNoteCount === 1 ? "note" : "notes"} carried forward`,
      detail: `Written on the lead before conversion · ${lead.name}`,
    });
  }
  if (carriedTaskCount > 0) {
    await logActivity({
      matterId,
      userId,
      type: "task",
      title: `${carriedTaskCount} intake ${carriedTaskCount === 1 ? "task" : "tasks"} carried forward`,
      detail: `Added on the lead before conversion · ${lead.name}`,
    });
  }
  if (carriedEventCount > 0) {
    await logActivity({
      matterId,
      userId,
      type: "event",
      title: `${carriedEventCount} intake ${carriedEventCount === 1 ? "event" : "events"} carried forward`,
      detail: `Scheduled on the lead before conversion · ${lead.name}`,
    });
    revalidatePath("/calendar");
  }
  if (carriedDocumentCount > 0) {
    await logActivity({
      matterId,
      userId,
      type: "document",
      title: `${carriedDocumentCount} intake ${carriedDocumentCount === 1 ? "document" : "documents"} carried forward`,
      detail: `Uploaded to the lead before conversion · ${lead.name}`,
    });
    revalidatePath(`/matters/${matterId}/documents`, "layout");
  }
  if (carriedRequestCount > 0) {
    await logActivity({
      matterId,
      userId,
      type: "records",
      title: `${carriedRequestCount} intake records ${carriedRequestCount === 1 ? "request" : "requests"} carried forward`,
      detail: `Created on the lead before conversion · ${lead.name}`,
    });
    revalidatePath(`/matters/${matterId}/records`);
  }
  if (carriedRecordsFeeCount > 0) {
    await logActivity({
      matterId,
      userId,
      type: "records",
      title: `${carriedRecordsFeeCount} records ${carriedRecordsFeeCount === 1 ? "fee" : "fees"} added as ${carriedRecordsFeeCount === 1 ? "an expense" : "expenses"}`,
      detail: `Paid on the lead before conversion · ${lead.name}`,
    });
    revalidatePath(`/matters/${matterId}/time`);
  }

  // Revalidate everything that displays leads or matters.
  revalidatePath("/intake");
  revalidatePath(`/intake/${leadId}`);
  revalidatePath("/matters");
  revalidatePath("/", "layout"); // sidebar pin list + dashboard

  redirect(`/matters/${matterId}`);
}

// ── Decline ─────────────────────────────────────────────────────────────

const declineSchema = z.object({
  reason: z.string().trim().max(2000).optional().or(z.literal("")),
});

export async function declineLead(
  leadId: string,
  _prev: DeclineLeadFormState,
  formData: FormData
): Promise<DeclineLeadFormState> {
  // Declining permanently removes the lead from the active intake
  // queue — an intake decision, gated granularly like its
  // conflict-check siblings rather than left open to any
  // authenticated user. Fail-closed until the key is granted via
  // the role matrix (admins always pass).
  const actorId = await requirePermission("intake.decline");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = declineSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { stage: true, name: true, contact: { select: { name: true } } },
  });
  if (!lead) {
    return {
      status: "error",
      errors: { _form: ["Lead no longer exists"] },
    };
  }
  if (lead.stage === CONVERTED) {
    return {
      status: "error",
      errors: { _form: [DECLINE_AFTER_CONVERT_ERROR] },
    };
  }
  if (lead.stage === DECLINED) {
    return { status: "error", errors: { _form: [ALREADY_DECLINED_ERROR] } };
  }

  // Conditional write: a convert (or another decline) that committed
  // between the read above and this write must not be overwritten —
  // that would flip a converted lead to declined, or rewrite the
  // stored reason and double-log the decline.
  const declined = await prisma.lead.updateMany({
    where: { id: leadId, stage: { notIn: [CONVERTED, DECLINED] } },
    data: {
      stage: DECLINED,
      declineReason: parsed.data.reason || null,
    },
  });
  if (declined.count === 0) {
    const current = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { stage: true },
    });
    const message = !current
      ? "Lead no longer exists"
      : current.stage === CONVERTED
        ? DECLINE_AFTER_CONVERT_ERROR
        : ALREADY_DECLINED_ERROR;
    return { status: "error", errors: { _form: [message] } };
  }

  // matterId: null — declined leads never got a matter. Firm-scope
  // audit entry so who declined (and why) is reviewable, matching
  // the conflict-check actions.
  await logActivity({
    matterId: null,
    userId: actorId,
    type: "filing",
    // "filing" would label this "Documents" in the feeds.
    source: "Intake",
    // ActivityLog has no lead reference, so the lead is named in the
    // title and identified by id in the detail (same as the
    // conflict-check entries).
    title: `Lead declined: ${lead.contact?.name ?? lead.name}`,
    detail: `lead ${leadId}: ${parsed.data.reason ?? ""}`,
  });

  revalidatePath("/intake");
  revalidatePath(`/intake/${leadId}`);
  return { status: "ok" };
}
