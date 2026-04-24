/**
 * Matter server actions.
 *
 * Writes that create or mutate `Matter` rows. For now: create. Edit,
 * archive, and stage-change actions will land here as they're built.
 */

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  NEW_CLIENT_SENTINEL,
  type CreateMatterState,
} from "@/lib/new-matter-constants";

const AREA_COLOR: Record<string, string> = {
  "§1983": "#2563a8",
  "Housing/FHA": "#2d8a5f",
  "Employment/CADA": "#b6623d",
  Criminal: "#7a5aa6",
  Class: "#8a6a2d",
  ADA: "#3a8a7a",
  "Education/IDEA": "#3a8a7a",
};

const createMatterSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(200, "Name is too long"),
    area: z.enum([
      "§1983",
      "Housing/FHA",
      "Employment/CADA",
      "Criminal",
      "Class",
      "ADA",
      "Education/IDEA",
    ]),
    stage: z
      .enum([
        "Intake",
        "Pre-suit",
        "Retained",
        "Discovery",
        "Dispositive",
        "Pretrial",
        "Cert",
        "Trial/Settle",
        "Settled",
        "Closed",
      ])
      .default("Intake"),
    feeStructure: z
      .enum(["contingent", "hourly", "flat", "hybrid", "pro_bono"])
      .default("contingent"),
    caseNumber: z.string().trim().max(80).optional().or(z.literal("")),
    court: z.string().trim().max(200).optional().or(z.literal("")),
    clientId: z.string().trim().optional().or(z.literal("")),
    /** When clientId === NEW_CLIENT_SENTINEL, these fields get used to
     *  create a new Contact inline before the Matter is written. */
    newClientName: z.string().trim().max(200).optional().or(z.literal("")),
    newClientEmail: z.string().trim().max(200).optional().or(z.literal("")),
    newClientPhone: z.string().trim().max(80).optional().or(z.literal("")),
    newClientOrganization: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal("")),
    opposingParty: z.string().trim().max(200).optional().or(z.literal("")),
    opposingFirm: z.string().trim().max(200).optional().or(z.literal("")),
    leadUserId: z.string().trim().min(1, "Lead attorney is required"),
    description: z.string().trim().max(4000).optional().or(z.literal("")),
    pinForMe: z.literal("on").optional(),
  })
  .superRefine((data, ctx) => {
    if (data.clientId === NEW_CLIENT_SENTINEL) {
      if (!data.newClientName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newClientName"],
          message: "Name is required for a new client",
        });
      }
      if (!data.newClientEmail && !data.newClientPhone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newClientEmail"],
          message: "Add an email or phone so the client is reachable",
        });
      }
      if (data.newClientEmail && !data.newClientEmail.includes("@")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newClientEmail"],
          message: "That doesn't look like an email address",
        });
      }
    }
  });

export async function createMatter(
  _prev: CreateMatterState,
  formData: FormData
): Promise<CreateMatterState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = createMatterSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const data = parsed.data;
  const currentUserId = await getCurrentUserId();

  // Verify the selected lead is a real user; fall through to the
  // current user if the posted value is stale.
  const lead = await prisma.user.findUnique({
    where: { id: data.leadUserId },
    select: { id: true },
  });
  const leadUserId = lead?.id ?? currentUserId;

  // Resolve client: either pick an existing Contact, create a new one
  // inline, or leave null.
  let clientId: string | null = null;
  if (data.clientId === NEW_CLIENT_SENTINEL) {
    const newClient = await prisma.contact.create({
      data: {
        name: data.newClientName!,
        email: data.newClientEmail || null,
        phone: data.newClientPhone || null,
        organization: data.newClientOrganization || null,
        type: "client",
      },
      select: { id: true },
    });
    clientId = newClient.id;
  } else if (data.clientId) {
    const client = await prisma.contact.findUnique({
      where: { id: data.clientId },
      select: { id: true },
    });
    clientId = client?.id ?? null;
  }

  const matter = await prisma.matter.create({
    data: {
      name: data.name,
      area: data.area,
      stage: data.stage,
      feeStructure: data.feeStructure,
      caseNumber: data.caseNumber || null,
      court: data.court || null,
      opposingParty: data.opposingParty || null,
      opposingFirm: data.opposingFirm || null,
      description: data.description || null,
      color: AREA_COLOR[data.area] ?? "#2563a8",
      clientId,
      teamMembers: {
        create: { userId: leadUserId, role: "lead" },
      },
      ...(data.pinForMe === "on"
        ? {
            pins: {
              create: { userId: currentUserId },
            },
          }
        : {}),
    },
  });

  // Sidebar + matters list both read fresh data on next render.
  revalidatePath("/", "layout");
  redirect(`/matters/${matter.id}`);
}

