/**
 * Where a records request's documents live:
 * `Investigation/Records Requests/<custodian — type>` in the request's
 * matter or intake (an existing root "Investigation" folder is reused).
 * A legacy root "Records" folder that already holds request files is
 * moved there and renamed on next use, so nothing is stranded. Folders are found-or-created inside
 * the caller's transaction, so a failed document write never leaves an
 * empty folder behind.
 *
 * "Whose folder is it?" is answered by `DocumentFolder.recordsRequestId`
 * + `systemKind` (set when the folder is created); a renamed folder is
 * still found. Rows with a non-null `systemKind` are protected from
 * rename / move / delete elsewhere.
 */

import type { Tx } from "@/lib/prisma";
import { nextAvailableFolderName } from "@/lib/folder-tree";
import { scopeWhere, type RecordScope } from "@/lib/record-scope";
import {
  LEGACY_RECORDS_ROOT_FOLDER_NAME,
  RECORDS_INVESTIGATION_FOLDER_NAME,
  RECORDS_ROOT_FOLDER_NAME,
  recordsFolderName,
} from "@/lib/records-requests/folder-name";
import { lockRecordsRequest } from "@/lib/records-requests/follow-up";
import { kindForRole } from "@/lib/records-requests/folder-kinds";
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
 *  at once can't each create the same parent folders. */
async function lockScopeFolders(tx: Tx, scope: RecordScope): Promise<void> {
  const key = `records-folder:${scope.kind === "matter" ? scope.matterId : scope.leadId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

type ScopeWhere = { matterId: string } | { leadId: string };

/** The child of `parentId` named `name` (case-insensitive), created
 *  at the end of its siblings when missing. */
async function findOrCreateChild(
  tx: Tx,
  where: ScopeWhere,
  parentId: string | null,
  name: string,
): Promise<string> {
  const siblings = await tx.documentFolder.findMany({
    where: { ...where, parentId },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const lower = name.toLowerCase();
  const found = siblings.find((f) => f.name.toLowerCase() === lower);
  if (found) return found.id;
  const created = await tx.documentFolder.create({
    data: { ...where, parentId, name, order: siblings.length },
    select: { id: true },
  });
  return created.id;
}

/** Link pre-existing request folders under an adopted legacy root, the
 *  way the migration backfill does: each child becomes `records_request`
 *  for the request owning the most documents tagged in it or its direct
 *  subfolders (ties -> earliest request); childless-of-tags stay
 *  unmarked; role subfolders get the matching kind and the same link. */
export async function linkRecordsFoldersUnder(
  tx: Tx,
  where: ScopeWhere,
  rootId: string,
): Promise<void> {
  const children = await tx.documentFolder.findMany({
    where: { ...where, parentId: rootId },
    select: { id: true },
  });
  for (const child of children) {
    const subs = await tx.documentFolder.findMany({
      where: { ...where, parentId: child.id },
      select: { id: true, name: true },
    });
    const tagged = await tx.document.findMany({
      where: {
        folderId: { in: [child.id, ...subs.map((f) => f.id)] },
        recordsRequestId: { not: null },
      },
      select: { recordsRequestId: true },
    });
    if (tagged.length === 0) continue;
    const counts = new Map<string, number>();
    for (const d of tagged) {
      const id = d.recordsRequestId as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const best = Math.max(...counts.values());
    const winner = await tx.recordsRequest.findFirst({
      where: {
        id: { in: [...counts].filter(([, n]) => n === best).map(([id]) => id) },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!winner) continue;
    await tx.documentFolder.update({
      where: { id: child.id },
      data: { systemKind: "records_request", recordsRequestId: winner.id },
    });
    for (const r of RECORDS_DOC_ROLES) {
      const n = RECORDS_ROLE_INFO[r].folderName.toLowerCase();
      for (const sub of subs.filter((f) => f.name.toLowerCase() === n)) {
        await tx.documentFolder.update({
          where: { id: sub.id },
          data: { systemKind: kindForRole(r), recordsRequestId: winner.id },
        });
      }
    }
  }
}

/** `Investigation/Records Requests`, adopting a legacy root "Records"
 *  folder (moved + renamed) when it already holds request files and no
 *  "Records Requests" exists yet. A root "Records" with no request
 *  files is someone's own folder and is left alone. */
async function resolveRecordsRoot(
  tx: Tx,
  where: ScopeWhere,
  investigationId: string,
): Promise<string> {
  const stamped = await tx.documentFolder.findFirst({
    where: { ...where, parentId: investigationId, systemKind: "records_root" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (stamped) return stamped.id;

  const existing = await tx.documentFolder.findFirst({
    where: {
      ...where,
      parentId: investigationId,
      name: { equals: RECORDS_ROOT_FOLDER_NAME, mode: "insensitive" },
    },
    select: { id: true, systemKind: true },
  });
  if (existing) {
    if (existing.systemKind !== "records_root") {
      await tx.documentFolder.update({
        where: { id: existing.id },
        data: { systemKind: "records_root" },
      });
    }
    return existing.id;
  }

  const legacy = await tx.documentFolder.findFirst({
    where: {
      ...where,
      parentId: null,
      name: { equals: LEGACY_RECORDS_ROOT_FOLDER_NAME, mode: "insensitive" },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (legacy) {
    // Request folders sit two levels down at most (request folder, then
    // its role subfolders).
    const level1 = await tx.documentFolder.findMany({
      where: { ...where, parentId: legacy.id },
      select: { id: true },
    });
    const level2 = level1.length
      ? await tx.documentFolder.findMany({
          where: { ...where, parentId: { in: level1.map((f) => f.id) } },
          select: { id: true },
        })
      : [];
    const holdsRequestFiles =
      level1.length > 0 &&
      (await tx.document.count({
        where: {
          folderId: { in: [...level1, ...level2].map((f) => f.id) },
          recordsRequestId: { not: null },
        },
      })) > 0;
    if (holdsRequestFiles) {
      const siblings = await tx.documentFolder.count({
        where: { ...where, parentId: investigationId },
      });
      await tx.documentFolder.update({
        where: { id: legacy.id },
        data: {
          parentId: investigationId,
          name: RECORDS_ROOT_FOLDER_NAME,
          order: siblings,
          systemKind: "records_root",
        },
      });
      await linkRecordsFoldersUnder(tx, where, legacy.id);
      return legacy.id;
    }
  }

  const created = await tx.documentFolder.create({
    data: {
      ...where,
      parentId: investigationId,
      name: RECORDS_ROOT_FOLDER_NAME,
      order: await tx.documentFolder.count({
        where: { ...where, parentId: investigationId },
      }),
      systemKind: "records_root",
    },
    select: { id: true },
  });
  return created.id;
}

export async function resolveRecordsFolder(
  tx: Tx,
  request: RecordsFolderRequest,
): Promise<string> {
  const scope = scopeFromRequest(request);
  const where = scopeWhere(scope);
  await lockRecordsRequest(tx, request.id);
  await lockScopeFolders(tx, scope);

  const investigationId = await findOrCreateChild(
    tx,
    where,
    null,
    RECORDS_INVESTIGATION_FOLDER_NAME,
  );
  const rootId = await resolveRecordsRoot(tx, where, investigationId);

  const linked = await tx.documentFolder.findFirst({
    where: { ...where, recordsRequestId: request.id, systemKind: "records_request" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (linked) return linked.id;

  const children = await tx.documentFolder.findMany({
    where: { ...where, parentId: rootId },
    select: { name: true },
  });
  const taken = new Set(children.map((c) => c.name.toLowerCase()));
  const created = await tx.documentFolder.create({
    data: {
      ...where,
      parentId: rootId,
      name: nextAvailableFolderName(
        recordsFolderName(request.custodianName, request.typeName),
        taken,
      ),
      order: children.length,
      systemKind: "records_request",
      recordsRequestId: request.id,
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
    select: { id: true, systemKind: true },
    orderBy: { createdAt: "asc" },
  });
  const ids = {} as Record<RecordsDocRole, string>;
  for (const r of RECORDS_DOC_ROLES) {
    const found = children.find((c) => c.systemKind === kindForRole(r));
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
        systemKind: kindForRole(r),
        recordsRequestId: request.id,
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
