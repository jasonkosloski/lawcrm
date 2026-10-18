/**
 * Records request type actions — settings CRUD for the firm's list of
 * request types (name, statutory response period, chase interval,
 * default letter template). All gated `records.types.manage`.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import type { RecordsRequestFormState } from "@/lib/records-requests/form";

const KEY = "records.types.manage";
const PATH = "/settings/records-types";

const schema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(80, "Name is too long (80 max)."),
    responseAmount: z.string().trim(),
    responseUnit: z.string().trim(),
    followUpDays: z.string().trim(),
    defaultTemplateId: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if (v.responseAmount !== "") {
      const n = Number(v.responseAmount);
      if (!/^\d+$/.test(v.responseAmount) || n < 1 || n > 365) {
        ctx.addIssue({
          code: "custom",
          path: ["responseAmount"],
          message: "Enter a whole number from 1 to 365.",
        });
      }
      if (v.responseUnit !== "CALENDAR_DAYS" && v.responseUnit !== "BUSINESS_DAYS") {
        ctx.addIssue({
          code: "custom",
          path: ["responseUnit"],
          message: "Choose calendar or business days.",
        });
      }
    }
    const f = Number(v.followUpDays);
    if (!/^\d+$/.test(v.followUpDays) || f < 1 || f > 90) {
      ctx.addIssue({
        code: "custom",
        path: ["followUpDays"],
        message: "Enter a whole number from 1 to 90.",
      });
    }
  });

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const k = String(issue.path[0] ?? "form");
    (errors[k] ??= []).push(issue.message);
  }
  return errors;
}

function rawValues(fd: FormData): Record<string, string> {
  const get = (k: string) => String(fd.get(k) ?? "");
  return {
    name: get("name"),
    responseAmount: get("responseAmount"),
    responseUnit: get("responseUnit"),
    followUpDays: get("followUpDays"),
    defaultTemplateId: get("defaultTemplateId"),
  };
}

type TypeData = {
  name: string;
  responseAmount: number | null;
  responseUnit: "CALENDAR_DAYS" | "BUSINESS_DAYS" | null;
  followUpDays: number;
  defaultTemplateId: string | null;
};

async function validate(
  fd: FormData,
  selfId: string | null
): Promise<
  | { ok: true; data: TypeData; name: string }
  | { ok: false; state: RecordsRequestFormState }
> {
  const values = rawValues(fd);
  const parsed = schema.safeParse(values);
  const errors = parsed.success ? {} : fieldErrors(parsed.error);
  if (!errors.name) {
    const dup = await prisma.recordsRequestType.findFirst({
      where: {
        isActive: true,
        name: { equals: values.name.trim(), mode: "insensitive" },
        ...(selfId ? { id: { not: selfId } } : {}),
      },
      select: { id: true },
    });
    if (dup) errors.name = ["An active request type with this name already exists."];
  }
  if (values.defaultTemplateId !== "") {
    const t = await prisma.documentTemplate.findFirst({
      where: { id: values.defaultTemplateId, isActive: true },
      select: { id: true },
    });
    if (!t) errors.defaultTemplateId = ["Choose an active template."];
  }
  if (!parsed.success || Object.keys(errors).length > 0) {
    return { ok: false, state: { status: "error", errors, values } };
  }
  const v = parsed.data;
  const hasAmount = v.responseAmount !== "";
  return {
    ok: true,
    name: v.name,
    data: {
      name: v.name,
      responseAmount: hasAmount ? Number(v.responseAmount) : null,
      responseUnit: hasAmount ? (v.responseUnit as TypeData["responseUnit"]) : null,
      followUpDays: Number(v.followUpDays),
      defaultTemplateId: v.defaultTemplateId === "" ? null : v.defaultTemplateId,
    },
  };
}

export async function createRecordsRequestType(
  _prev: RecordsRequestFormState,
  fd: FormData
): Promise<RecordsRequestFormState> {
  const userId = await requirePermission(KEY);
  const res = await validate(fd, null);
  if (!res.ok) return res.state;
  const last = await prisma.recordsRequestType.aggregate({ _max: { sortOrder: true } });
  await prisma.recordsRequestType.create({
    data: {
      ...res.data,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
    },
  });
  await logActivity({
    matterId: null,
    userId,
    type: "records",
    title: `Added records request type "${res.name}"`,
    detail: null,
  });
  revalidatePath(PATH);
  return { status: "ok" };
}

export async function updateRecordsRequestType(
  id: string,
  _prev: RecordsRequestFormState,
  fd: FormData
): Promise<RecordsRequestFormState> {
  const userId = await requirePermission(KEY);
  const existing = await prisma.recordsRequestType.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return { status: "error", errors: { form: ["Request type not found."] } };
  }
  const res = await validate(fd, id);
  if (!res.ok) return res.state;
  await prisma.recordsRequestType.update({ where: { id }, data: res.data });
  await logActivity({
    matterId: null,
    userId,
    type: "records",
    title: `Updated records request type "${res.name}"`,
    detail: null,
  });
  revalidatePath(PATH);
  return { status: "ok" };
}

export async function setRecordsRequestTypeActive(
  id: string,
  active: boolean
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission(KEY);
  const row = await prisma.recordsRequestType.findUnique({
    where: { id },
    select: { name: true, isActive: true },
  });
  if (!row) return { ok: false, error: "Not found" };
  if (row.isActive === active) return { ok: true };
  if (active) {
    const dup = await prisma.recordsRequestType.findFirst({
      where: {
        isActive: true,
        id: { not: id },
        name: { equals: row.name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (dup) {
      return {
        ok: false,
        error: "An active request type with this name already exists. Rename one first.",
      };
    }
  }
  await prisma.recordsRequestType.update({ where: { id }, data: { isActive: active } });
  await logActivity({
    matterId: null,
    userId,
    type: "records",
    title: `${active ? "Restored" : "Archived"} records request type "${row.name}"`,
    detail: null,
  });
  revalidatePath(PATH);
  return { ok: true };
}

export async function moveRecordsRequestType(
  id: string,
  direction: "up" | "down"
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission(KEY);
  const row = await prisma.recordsRequestType.findUnique({
    where: { id },
    select: { name: true, isActive: true },
  });
  if (!row) return { ok: false, error: "Not found" };
  if (!row.isActive) return { ok: true };
  // Swap among the visible (active) types only; (sortOrder, name, id)
  // matches the list order.
  const all = await prisma.recordsRequestType.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true, sortOrder: true },
  });
  const idx = all.findIndex((t) => t.id === id);
  const target = direction === "up" ? idx - 1 : idx + 1;
  if (idx === -1 || target < 0 || target >= all.length) return { ok: true };
  // Always renumber densely: seeded rows may tie on sortOrder.
  const next = all.map((t) => t.id);
  [next[idx], next[target]] = [next[target], next[idx]];
  await prisma.$transaction(
    next.map((tid, i) =>
      prisma.recordsRequestType.update({ where: { id: tid }, data: { sortOrder: i } })
    )
  );
  await logActivity({
    matterId: null,
    userId,
    type: "records",
    title: `Reordered records request type "${row.name}" ${direction}`,
    detail: null,
  });
  revalidatePath(PATH);
  return { ok: true };
}
