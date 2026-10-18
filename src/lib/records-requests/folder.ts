/**
 * Where a records request's documents live: `Records/<custodian — type>`
 * in the request's matter or intake. Folders are found-or-created inside
 * the caller's transaction, so a failed document write never leaves an
 * empty folder behind.
 *
 * "Whose folder is it?" has no schema column: a child folder belongs to
 * a request when it holds one of that request's documents. A child that
 * holds another request's documents is claimed and forces a " (2)"
 * suffix; an empty (or untagged-only) child with the right name is
 * reused, so resolving twice yields the same folder.
 */

import type { Tx } from "@/lib/prisma";
import { nextAvailableFolderName } from "@/lib/folder-tree";
import { scopeWhere, type RecordScope } from "@/lib/record-scope";
import {
  RECORDS_ROOT_FOLDER_NAME,
  recordsFolderName,
} from "@/lib/records-requests/folder-name";
import { lockRecordsRequest } from "@/lib/records-requests/follow-up";

export type RecordsFolderRequest = {
  id: string;
  matterId: string | null;
  leadId: string | null;
  custodianName: string;
  typeName: string;
};

function scopeFromRequest(r: RecordsFolderRequest): RecordScope {
  if (r.matterId) return { kind: "matter", matterId: r.matterId };
  if (r.leadId) return { kind: "lead", leadId: r.leadId };
  throw new Error("Records request has no matter or lead.");
}

/** Serialize root/child creation per scope so two requests resolving
 *  at once can't each create a "Records" root. */
async function lockScopeFolders(tx: Tx, scope: RecordScope): Promise<void> {
  const key = `records-folder:${scope.kind === "matter" ? scope.matterId : scope.leadId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

export async function resolveRecordsFolder(
  tx: Tx,
  request: RecordsFolderRequest
): Promise<string> {
  const scope = scopeFromRequest(request);
  const where = scopeWhere(scope);
  await lockRecordsRequest(tx, request.id);
  await lockScopeFolders(tx, scope);

  const roots = await tx.documentFolder.findMany({
    where: { ...where, parentId: null },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const rootName = RECORDS_ROOT_FOLDER_NAME.toLowerCase();
  let rootId = roots.find((f) => f.name.toLowerCase() === rootName)?.id;
  if (!rootId) {
    const created = await tx.documentFolder.create({
      data: {
        ...where,
        parentId: null,
        name: RECORDS_ROOT_FOLDER_NAME,
        order: roots.length,
      },
      select: { id: true },
    });
    rootId = created.id;
  }

  const base = recordsFolderName(request.custodianName, request.typeName);
  const baseLower = base.toLowerCase();
  const children = await tx.documentFolder.findMany({
    where: { ...where, parentId: rootId },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  // Folders this request could be using: the base name or "base (n)".
  const variant = new RegExp(
    `^${baseLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\(\\d+\\))?$`
  );
  const candidates = children.filter((c) => variant.test(c.name.toLowerCase()));
  if (candidates.length > 0) {
    const tagged = await tx.document.findMany({
      where: {
        folderId: { in: candidates.map((c) => c.id) },
        recordsRequestId: { not: null },
      },
      select: { folderId: true, recordsRequestId: true },
    });
    const own = new Set<string>();
    const claimed = new Set<string>();
    for (const d of tagged) {
      if (!d.folderId) continue;
      (d.recordsRequestId === request.id ? own : claimed).add(d.folderId);
    }
    const mine = candidates.find((c) => own.has(c.id));
    if (mine) return mine.id;
    const free = candidates.find((c) => !claimed.has(c.id));
    if (free) return free.id;
  }

  const taken = new Set(children.map((c) => c.name.toLowerCase()));
  const created = await tx.documentFolder.create({
    data: {
      ...where,
      parentId: rootId,
      name: nextAvailableFolderName(base, taken),
      order: children.length,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Re-check a records request against the FINAL scope of an upload and
 * work out the folder + tags for the new document. Returns null when
 * the request no longer belongs to `scope` (deleted, or re-homed
 * elsewhere) — callers then file the document without the records tag
 * rather than failing the upload.
 */
export async function resolveRecordsUpload(
  tx: Tx,
  requestId: string,
  scope: RecordScope,
  folderId: string | null
): Promise<{
  folderId: string;
  recordsRequestId: string;
  recordsRequestRole: "received_records";
} | null> {
  const r = await tx.recordsRequest.findFirst({
    where: { id: requestId, ...scopeWhere(scope) },
    select: {
      id: true,
      matterId: true,
      leadId: true,
      adHocTypeName: true,
      custodian: { select: { name: true } },
      type: { select: { name: true } },
    },
  });
  if (!r) return null;
  const resolved =
    folderId ??
    (await resolveRecordsFolder(tx, {
      id: r.id,
      matterId: r.matterId,
      leadId: r.leadId,
      custodianName: r.custodian.name,
      typeName: r.type?.name ?? r.adHocTypeName ?? "Records",
    }));
  return {
    folderId: resolved,
    recordsRequestId: r.id,
    recordsRequestRole: "received_records",
  };
}
