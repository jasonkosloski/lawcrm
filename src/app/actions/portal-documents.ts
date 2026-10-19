/**
 * Staff actions for portal document requests.
 *
 * Every action gates on its permission, then asserts matter access
 * (ADR-039) outside any try/catch so a walled user gets Next's
 * not-found. Status transitions are compare-and-swap `updateMany`s so
 * two racing actions can never both win.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { requirePermissionResult } from "@/lib/permission-check";
import { logActivity, logActivityTx } from "@/lib/activity-log";
import { parseDateOnly } from "@/lib/format-date";
import { documentRequestEmail } from "@/lib/portal/emails";
import { portalHomeUrl } from "@/lib/portal/link-url";
import { emailLivePortalUsers } from "@/lib/portal/notify-clients";

type Result = { ok: true } | { ok: false; error: string };
type Input = { title: string; instructions?: string; dueDate?: string };

const CONFLICT = "This request changed, refresh to see it.";
const NOT_FOUND = "Request not found.";
const HAS_FILES = "This request has files attached. Cancel it instead.";
const MAX_TITLE = 200;
const MAX_TEXT = 5000;

function parseInput(
  input: Input
):
  | { ok: true; title: string; instructions: string | null; dueDate: Date | null }
  | { ok: false; error: string } {
  const title = (input?.title ?? "").trim();
  if (!title) return { ok: false, error: "Enter a title." };
  if (title.length > MAX_TITLE) return { ok: false, error: "That title is too long." };
  const instructions = (input?.instructions ?? "").trim();
  if (instructions.length > MAX_TEXT) {
    return { ok: false, error: "Those instructions are too long." };
  }
  let dueDate: Date | null = null;
  if (input?.dueDate) {
    dueDate = parseDateOnly(input.dueDate);
    if (!dueDate) return { ok: false, error: "Enter a valid due date." };
  }
  return { ok: true, title, instructions: instructions || null, dueDate };
}

function done(matterId: string): Result {
  revalidatePath(`/matters/${matterId}`);
  return { ok: true };
}

export async function createDocumentRequest(
  matterId: string,
  input: Input
): Promise<Result> {
  const gate = await requirePermissionResult("portal.add_requests");
  if (!gate.ok) return { ok: false, error: gate.error };
  await assertMatterAccess(matterId);

  const parsed = parseInput(input);
  if (!parsed.ok) return parsed;

  await prisma.documentRequest.create({
    data: {
      matterId,
      title: parsed.title,
      instructions: parsed.instructions,
      dueDate: parsed.dueDate,
      createdById: gate.userId,
    },
  });

  let emailFailed = false;
  try {
    const res = await emailLivePortalUsers(
      matterId,
      documentRequestEmail(portalHomeUrl())
    );
    emailFailed = res.failed > 0;
  } catch (err) {
    console.warn("[portal-documents] request email failed", err);
    emailFailed = true;
  }
  await logActivity({
    matterId,
    userId: gate.userId,
    type: "document",
    title: `Requested documents from the client: ${parsed.title}`,
    detail: emailFailed ? "— email failed" : null,
  });
  return done(matterId);
}

async function loadRequest(id: string) {
  return prisma.documentRequest.findUnique({
    where: { id },
    select: { id: true, matterId: true, title: true, status: true },
  });
}

export async function updateDocumentRequest(
  id: string,
  input: Input
): Promise<Result> {
  const gate = await requirePermissionResult("portal.edit_requests");
  if (!gate.ok) return { ok: false, error: gate.error };
  const req = await loadRequest(id);
  if (!req) return { ok: false, error: NOT_FOUND };
  await assertMatterAccess(req.matterId);

  const parsed = parseInput(input);
  if (!parsed.ok) return parsed;

  const ok = await prisma.$transaction(async (tx) => {
    const { count } = await tx.documentRequest.updateMany({
      where: { id, status: "open" },
      data: {
        title: parsed.title,
        instructions: parsed.instructions,
        dueDate: parsed.dueDate,
      },
    });
    if (count === 0) return false;
    await logActivityTx(tx, {
      matterId: req.matterId,
      userId: gate.userId,
      type: "document",
      title: `Edited document request: ${parsed.title}`,
    });
    return true;
  });
  if (!ok) return { ok: false, error: CONFLICT };
  return done(req.matterId);
}

async function transition(
  id: string,
  from: string[],
  data: Record<string, unknown>,
  title: (t: string) => string,
  detail?: string
): Promise<Result> {
  const gate = await requirePermissionResult("portal.edit_requests");
  if (!gate.ok) return { ok: false, error: gate.error };
  const req = await loadRequest(id);
  if (!req) return { ok: false, error: NOT_FOUND };
  await assertMatterAccess(req.matterId);

  const ok = await prisma.$transaction(async (tx) => {
    const { count } = await tx.documentRequest.updateMany({
      where: { id, status: { in: from } },
      data,
    });
    if (count === 0) return false;
    await logActivityTx(tx, {
      matterId: req.matterId,
      userId: gate.userId,
      type: "document",
      title: title(req.title),
      detail: detail ?? null,
    });
    return true;
  });
  if (!ok) return { ok: false, error: CONFLICT };
  return done(req.matterId);
}

export async function acceptDocumentRequest(id: string): Promise<Result> {
  return transition(
    id,
    ["submitted"],
    { status: "complete", completedAt: new Date() },
    (t) => `Accepted client documents: ${t}`
  );
}

export async function sendBackDocumentRequest(
  id: string,
  note: string
): Promise<Result> {
  const trimmed = (note ?? "").trim();
  if (!trimmed) return { ok: false, error: "Enter a note for the client." };
  if (trimmed.length > MAX_TEXT) return { ok: false, error: "That note is too long." };
  return transition(
    id,
    ["submitted"],
    { status: "open", returnNote: trimmed },
    (t) => `Sent back document request: ${t}`
  );
}

export async function cancelDocumentRequest(id: string): Promise<Result> {
  return transition(
    id,
    ["open", "submitted"],
    { status: "cancelled" },
    (t) => `Cancelled document request: ${t}`
  );
}

export async function deleteDocumentRequest(id: string): Promise<Result> {
  const gate = await requirePermissionResult("portal.delete_requests");
  if (!gate.ok) return { ok: false, error: gate.error };
  const req = await loadRequest(id);
  if (!req) return { ok: false, error: NOT_FOUND };
  await assertMatterAccess(req.matterId);

  const res = await prisma.$transaction(async (tx) => {
    // Lock the row so a concurrent upload can't slip between the
    // check and the delete.
    await tx.$queryRaw`SELECT id FROM document_requests WHERE id = ${id} FOR UPDATE`;
    const linked = await tx.document.count({ where: { documentRequestId: id } });
    if (linked > 0) return HAS_FILES;
    const { count } = await tx.documentRequest.deleteMany({ where: { id } });
    if (count === 0) return CONFLICT;
    await logActivityTx(tx, {
      matterId: req.matterId,
      userId: gate.userId,
      type: "document",
      title: `Deleted document request: ${req.title}`,
    });
    return null;
  });
  if (res) return { ok: false, error: res };
  return done(req.matterId);
}
