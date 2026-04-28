/**
 * Lead intake server actions — convert and decline.
 *
 * v1 keeps both flows minimal:
 *   - convertLeadToMatter: create a Matter from the lead's basic
 *     details + a Contact for the lead person, link them, mark the
 *     lead as converted, redirect to the new matter.
 *   - declineLead: capture an optional reason, mark stage "declined".
 *
 * Practice-area-specific automations (CGIA notice deadlines for §1983,
 * HUD response for FHA, etc.) are explicit follow-ups in
 * docs/FEATURES.md — this action just creates the matter so the user
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
import type {
  ConvertLeadFormState,
  DeclineLeadFormState,
} from "@/lib/lead-conversion-form";

// ── Convert ─────────────────────────────────────────────────────────────

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
      `Date of incident: ${lead.dateOfIncident.toISOString().slice(0, 10)}`
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
  if (lead.stage === "converted") {
    return {
      status: "error",
      errors: { _form: ["Lead is already converted to a matter."] },
    };
  }

  // Validate the picked stage actually belongs to the picked area —
  // the form picker enforces this client-side, but the server is the
  // source of truth.
  const [area, stage] = await Promise.all([
    prisma.practiceArea.findUnique({
      where: { id: parsed.data.practiceAreaId },
      // defaultBillingMode snapshots onto the new Matter so the
      // billing tab shows the right flow from day one.
      select: { id: true, color: true, defaultBillingMode: true },
    }),
    prisma.matterStage.findUnique({
      where: { id: parsed.data.stageId },
      select: { id: true, practiceAreaId: true },
    }),
  ]);
  if (!area) {
    return {
      status: "error",
      errors: { practiceAreaId: ["Practice area not found"] },
    };
  }
  if (!stage || stage.practiceAreaId !== area.id) {
    return {
      status: "error",
      errors: { stageId: ["Stage doesn't belong to the selected area"] },
    };
  }

  const userId = await getCurrentUserId();
  const description = composeMatterDescription(lead);

  // Single transaction so a half-converted lead can't exist.
  const matterId = await prisma.$transaction(async (tx) => {
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
      },
      select: { id: true },
    });

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

    // Mark lead converted so it leaves the active intake queue.
    await tx.lead.update({
      where: { id: leadId },
      data: {
        stage: "converted",
        convertedMatterId: matter.id,
      },
    });

    return matter.id;
  });

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
    select: { stage: true },
  });
  if (!lead) {
    return {
      status: "error",
      errors: { _form: ["Lead no longer exists"] },
    };
  }
  if (lead.stage === "converted") {
    return {
      status: "error",
      errors: {
        _form: ["Lead is already converted — can't decline a matter that exists."],
      },
    };
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      stage: "declined",
      declineReason: parsed.data.reason || null,
    },
  });

  revalidatePath("/intake");
  revalidatePath(`/intake/${leadId}`);
  return { status: "ok" };
}
