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
import { logAuditEntry } from "@/lib/audit-entry";
import type { VenueOption } from "@/lib/queries/venues";
import { isForeignKeyViolation, isRecordNotFound, isUniqueViolation } from "@/lib/prisma-errors";

export type VenueInput = { name: string; city?: string; county?: string; state: string };

type Invalid = { ok: false; code: "invalid"; errors: Record<string, string[]> };

const schema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long (120 max)."),
  city: z.string().trim().max(80, "City is too long (80 max).").optional(),
  county: z.string().trim().max(80, "County is too long (80 max).").optional(),
  state: z.string().trim().min(1, "State is required.").max(60, "State is too long (60 max)."),
});

const SELECT = {
  id: true,
  name: true,
  city: true,
  county: true,
  state: true,
  isActive: true,
} as const;

function parse(
  input: VenueInput
): { ok: true; data: { name: string; city: string | null; county: string | null; state: string } } | Invalid {
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
    data: { name: v.name, city: v.city || null, county: v.county || null, state: v.state },
  };
}

function revalidate() {
  revalidatePath("/settings/venues");
  revalidatePath("/matters/new");
}

export async function createVenue(
  input: VenueInput
): Promise<
  | { ok: true; venue: VenueOption }
  | { ok: false; code: "exists"; venue: VenueOption }
  | { ok: false; code: "archived"; venue: VenueOption }
  | Invalid
> {
  const userId = await requirePermission("venues.add");
  const p = parse(input);
  if (!p.ok) return p;
  const nameKey = p.data.name.toLowerCase();
  try {
    const venue = await prisma.venue.create({ data: { ...p.data, nameKey }, select: SELECT });
    await logAuditEntry({
      matterId: null,
      userId,
      type: "settings",
      source: "Settings",
      icon: "zap",
      title: `Venue "${venue.name}" added`,
      detail: null,
    });
    revalidate();
    return { ok: true, venue };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = await prisma.venue.findUnique({ where: { nameKey }, select: SELECT });
    if (!existing) throw e;
    return { ok: false, code: existing.isActive ? "exists" : "archived", venue: existing };
  }
}

export async function updateVenue(
  id: string,
  input: VenueInput
): Promise<
  | { ok: true; venue: VenueOption }
  | { ok: false; code: "exists"; venue: VenueOption }
  | { ok: false; code: "notfound" }
  | Invalid
> {
  const userId = await requirePermission("venues.edit");
  const p = parse(input);
  if (!p.ok) return p;
  const nameKey = p.data.name.toLowerCase();
  try {
    const venue = await prisma.venue.update({
      where: { id },
      data: { ...p.data, nameKey },
      select: SELECT,
    });
    await logAuditEntry({
      matterId: null,
      userId,
      type: "settings",
      source: "Settings",
      icon: "zap",
      title: `Venue "${venue.name}" updated`,
      detail: null,
    });
    revalidate();
    return { ok: true, venue };
  } catch (e) {
    if (isRecordNotFound(e)) {
      return { ok: false, code: "notfound" };
    }
    if (!isUniqueViolation(e)) throw e;
    const existing = await prisma.venue.findUnique({ where: { nameKey }, select: SELECT });
    if (!existing) throw e;
    return { ok: false, code: "exists", venue: existing };
  }
}

export async function setVenueActive(
  id: string,
  active: boolean
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("venues.edit");
  const row = await prisma.venue.findUnique({
    where: { id },
    select: { name: true, isActive: true },
  });
  if (!row) return { ok: false, error: "Not found" };
  if (row.isActive === active) return { ok: true };
  await prisma.venue.update({ where: { id }, data: { isActive: active } });
  await logAuditEntry({
    matterId: null,
    userId,
    type: "settings",
    source: "Settings",
    icon: "zap",
    title: `Venue "${row.name}" ${active ? "restored" : "archived"}`,
    detail: null,
  });
  revalidate();
  return { ok: true };
}

export async function deleteVenue(
  id: string
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
  await logAuditEntry({
    matterId: null,
    userId,
    type: "settings",
    source: "Settings",
    icon: "zap",
    title: `Venue "${row.name}" deleted`,
    detail: null,
  });
  revalidate();
  return { ok: true };
}
