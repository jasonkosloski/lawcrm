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
import {
  RECORDS_DOC_ROLES,
  RECORDS_ROLE_INFO,
  type RecordsDocRole,
} from "@/lib/records-requests/roles";

export {
  RECORDS_REQUEST_DOCS_FOLDER,
  RECORDS_RESPONSIVE_DOCS_FOLDER,
} from "@/lib/records-requests/roles";

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
  request: RecordsFolderRequest,
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
    `^${baseLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\(\\d+\\))?$`,
  );
  const candidates = children.filter((c) => variant.test(c.name.toLowerCase()));
  if (candidates.length > 0) {
    // Tagged documents count toward the candidate itself and toward its
    // two role subfolders (a request whose files all live in subfolders
    // still owns its folder).
    const subs = await tx.documentFolder.findMany({
      where: {
        ...where,
        parentId: { in: candidates.map((c) => c.id) },
        name: {
          in: RECORDS_DOC_ROLES.map((r) => RECORDS_ROLE_INFO[r].folderName),
        },
      },
      select: { id: true, parentId: true },
    });
    const owner = new Map<string, string>(); // folder id -> candidate id
    for (const c of candidates) owner.set(c.id, c.id);
    for (const s of subs) if (s.parentId) owner.set(s.id, s.parentId);
    const tagged = await tx.document.findMany({
      where: {
        folderId: { in: [...owner.keys()] },
        recordsRequestId: { not: null },
      },
      select: { folderId: true, recordsRequestId: true },
    });
    const own = new Set<string>();
    const claimed = new Set<string>();
    for (const d of tagged) {
      const cand = d.folderId ? owner.get(d.folderId) : undefined;
      if (!cand) continue;
      (d.recordsRequestId === request.id ? own : claimed).add(cand);
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
 * The request folder's fixed child for `role` (found-or-created, case-
 * insensitive). Also tidies: this request's documents sitting directly in
 * the request folder move into the subfolder matching their role (role
 * null stays put). Idempotent.
 */
export async function resolveRecordsRoleFolder(
  tx: Tx,
  request: RecordsFolderRequest,
  role: RecordsDocRole,
): Promise<string> {
  const parentId = await resolveRecordsFolder(tx, request);
  const where = scopeWhere(scopeFromRequest(request));
  const children = await tx.documentFolder.findMany({
    where: { ...where, parentId },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const ids = {} as Record<RecordsDocRole, string>;
  for (const r of RECORDS_DOC_ROLES) {
    const n = RECORDS_ROLE_INFO[r].folderName.toLowerCase();
    const found = children.find((c) => c.name.toLowerCase() === n);
    if (found) ids[r] = found.id;
  }
  const flat = await tx.document.findMany({
    where: {
      folderId: parentId,
      recordsRequestId: request.id,
      recordsRequestRole: { in: [...RECORDS_DOC_ROLES] },
    },
    select: { id: true, recordsRequestRole: true },
  });
  const needed = new Set<RecordsDocRole>([role]);
  for (const d of flat) needed.add(d.recordsRequestRole as RecordsDocRole);
  let order = children.length;
  for (const r of RECORDS_DOC_ROLES) {
    if (!needed.has(r) || ids[r]) continue;
    const created = await tx.documentFolder.create({
      data: {
        ...where,
        parentId,
        name: RECORDS_ROLE_INFO[r].folderName,
        order: order++,
      },
      select: { id: true },
    });
    ids[r] = created.id;
  }
  for (const r of RECORDS_DOC_ROLES) {
    const moving = flat
      .filter((d) => d.recordsRequestRole === r)
      .map((d) => d.id);
    if (moving.length === 0) continue;
    await tx.document.updateMany({
      where: { id: { in: moving } },
      data: { folderId: ids[r] },
    });
  }
  return ids[role];
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
  folderId: string | null,
  role: RecordsDocRole = "received_records",
): Promise<{
  folderId: string;
  recordsRequestId: string;
  recordsRequestRole: RecordsDocRole;
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
    (await resolveRecordsRoleFolder(
      tx,
      {
        id: r.id,
        matterId: r.matterId,
        leadId: r.leadId,
        custodianName: r.custodian.name,
        typeName: r.type?.name ?? r.adHocTypeName ?? "Records",
      },
      role,
    ));
  return {
    folderId: resolved,
    recordsRequestId: r.id,
    recordsRequestRole: role,
  };
}
