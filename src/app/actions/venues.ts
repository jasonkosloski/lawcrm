/**
 * Venue actions — courts / jurisdictions a matter is filed in. Take plain
 * objects (not FormData) because the matter-form combobox calls
 * `createVenue` directly from a client component.
 *
 * Names are unique case-insensitively across active AND archived rows
 * (`nameKey`); duplicates are detected by catching P2002 so two racing
 * creates can't both win.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { logSettingsChange } from "@/lib/audit-entry";
import type { VenueOption } from "@/lib/queries/venues";
import { isForeignKeyViolation, isRecordNotFound, isUniqueViolation } from "@/lib/prisma-errors";

export type VenueInput = {
  name: string;
  city?: string;
  county?: string;
  state: string;
  /** Court format applied to filings; undefined leaves it unchanged. */
  courtFormatId?: string | null;
  /** Name printed in the caption; undefined leaves it unchanged. */
  captionName?: string | null;
};

type Invalid = { ok: false; code: "invalid"; errors: Record<string, string[]> };

const schema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long (120 max)."),
  city: z.string().trim().max(80, "City is too long (80 max).").optional(),
  county: z.string().trim().max(80, "County is too long (80 max).").optional(),
  state: z.string().trim().min(1, "State is required.").max(60, "State is too long (60 max)."),
  courtFormatId: z.string().min(1).nullable().optional(),
  captionName: z
    .string()
    .trim()
    .max(300, "Caption name is too long (300 max).")
    .nullable()
    .optional(),
});

type VenueData = {
  name: string;
  city: string | null;
  county: string | null;
  state: string;
  courtFormatId?: string | null;
  captionName?: string | null;
};

const SELECT = {
  id: true,
  name: true,
  city: true,
  county: true,
  state: true,
  isActive: true,
} as const;

function parse(input: VenueInput): { ok: true; data: VenueData } | Invalid {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (errors[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
    }
    return { ok: false, code: "invalid", errors };
  }
  const v = parsed.data;
  return {
    ok: true,
    data: {
      name: v.name,
      city: v.city || null,
      county: v.county || null,
      state: v.state,
      ...(v.courtFormatId !== undefined ? { courtFormatId: v.courtFormatId } : {}),
      ...(v.captionName !== undefined ? { captionName: v.captionName?.trim() || null } : {}),
    },
  };
}

/** The format must exist; an archived one is accepted only when it is
 *  already this venue's format. */
async function checkCourtFormat(
  courtFormatId: string | null | undefined,
  currentVenueFormatId: string | null,
): Promise<Invalid | null> {
  if (!courtFormatId) return null;
  const format = await prisma.courtFormat.findUnique({
    where: { id: courtFormatId },
    select: { isActive: true },
  });
  const error = !format
    ? "That court format no longer exists."
    : !format.isActive && courtFormatId !== currentVenueFormatId
      ? "That court format is archived."
      : null;
  return error ? { ok: false, code: "invalid", errors: { courtFormatId: [error] } } : null;
}

const FORMAT_GONE: Invalid = {
  ok: false,
  code: "invalid",
  errors: { courtFormatId: ["That court format no longer exists — reload."] },
};

function revalidate() {
  revalidatePath("/settings/venues");
  revalidatePath("/matters/new");
}

export async function createVenue(
  input: VenueInput,
): Promise<
  | { ok: true; venue: VenueOption }
  | { ok: false; code: "exists"; venue: VenueOption }
  | { ok: false; code: "archived"; venue: VenueOption }
  | Invalid
> {
  const userId = await requirePermission("venues.add");
  const p = parse(input);
  if (!p.ok) return p;
  const bad = await checkCourtFormat(p.data.courtFormatId, null);
  if (bad) return bad;
  const nameKey = p.data.name.toLowerCase();
  try {
    const venue = await prisma.venue.create({ data: { ...p.data, nameKey }, select: SELECT });
    await logSettingsChange(userId, `Venue "${venue.name}" added`);
    revalidate();
    return { ok: true, venue };
  } catch (e) {
    if (isForeignKeyViolation(e)) return FORMAT_GONE;
    if (!isUniqueViolation(e)) throw e;
    const existing = await prisma.venue.findUnique({ where: { nameKey }, select: SELECT });
    if (!existing) throw e;
    return { ok: false, code: existing.isActive ? "exists" : "archived", venue: existing };
  }
}

export async function updateVenue(
  id: string,
  input: VenueInput,
): Promise<
  | { ok: true; venue: VenueOption }
  | { ok: false; code: "exists"; venue: VenueOption }
  | { ok: false; code: "notfound" }
  | Invalid
> {
  const userId = await requirePermission("venues.edit");
  const p = parse(input);
  if (!p.ok) return p;
  const current = await prisma.venue.findUnique({
    where: { id },
    select: { courtFormatId: true },
  });
  if (!current) return { ok: false, code: "notfound" };
  const bad = await checkCourtFormat(p.data.courtFormatId, current.courtFormatId);
  if (bad) return bad;
  const nameKey = p.data.name.toLowerCase();
  try {
    const venue = await prisma.venue.update({
      where: { id },
      data: { ...p.data, nameKey },
      select: SELECT,
    });
    await logSettingsChange(userId, `Venue "${venue.name}" updated`);
    revalidate();
    return { ok: true, venue };
  } catch (e) {
    if (isRecordNotFound(e)) {
      return { ok: false, code: "notfound" };
    }
    if (isForeignKeyViolation(e)) return FORMAT_GONE;
    if (!isUniqueViolation(e)) throw e;
    const existing = await prisma.venue.findUnique({ where: { nameKey }, select: SELECT });
    if (!existing) throw e;
    return { ok: false, code: "exists", venue: existing };
  }
}

export async function setVenueActive(
  id: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("venues.edit");
  const row = await prisma.venue.findUnique({
    where: { id },
    select: { name: true, isActive: true },
  });
  if (!row) return { ok: false, error: "Not found" };
  if (row.isActive === active) return { ok: true };
  await prisma.venue.update({ where: { id }, data: { isActive: active } });
  await logSettingsChange(userId, `Venue "${row.name}" ${active ? "restored" : "archived"}`);
  revalidate();
  return { ok: true };
}

export async function deleteVenue(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requirePermission("venues.delete");
  const row = await prisma.venue.findUnique({ where: { id }, select: { name: true } });
  if (!row) return { ok: false, error: "Not found" };
  const inUse = "A matter uses this venue. Archive it instead.";
  if ((await prisma.matter.count({ where: { venueId: id } })) > 0) {
    return { ok: false, error: inUse };
  }
  try {
    await prisma.venue.delete({ where: { id } });
  } catch (e) {
    // FK restrict: a matter picked this venue after the count above.
    if (isForeignKeyViolation(e)) {
      return { ok: false, error: inUse };
    }
    throw e;
  }
  await logSettingsChange(userId, `Venue "${row.name}" deleted`);
  revalidate();
  return { ok: true };
}
