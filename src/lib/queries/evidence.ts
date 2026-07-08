/**
 * Data loaders for the evidence-review surfaces.
 *
 *  - `getDocumentFlaggedMoments(documentId)` — the viewer's flags
 *    rail: every flag on one document, anchor-ordered.
 *  - `getMatterFlaggedMoments(matterId)` — the matter Evidence tab:
 *    ONE query across the matter's documents, grouped in JS by
 *    document (name asc, id tiebreak — the Documents tab's walk
 *    order) with flags anchor-ordered inside each group.
 *
 * ALL anchor kinds surface (time, page, quote, anchorless — see
 * `src/lib/flag-anchor.ts`). Within a document, ordering is
 * time-asc, then page-asc, nulls last, createdAt tiebreak — a
 * document's flags share one anchored kind (action-layer invariant),
 * so this reads as "in anchor order, whole-document flags at the
 * end, quote flags in capture order."
 *
 * Category filtering is deliberately NOT pushed into SQL — the tab's
 * pills need per-category counts of the full set anyway, so the page
 * filters the returned rows and the counts stay free.
 *
 * `FlaggedMoment.evidenceId` rows (the future Evidence-pipeline
 * side of the exactly-one-of invariant) are excluded by shape: both
 * loaders join through `document`, so evidence-attached flags never
 * appear here.
 */

import { prisma } from "@/lib/prisma";
import {
  resolveDocumentRenderer,
  type DocumentRenderer,
} from "@/components/documents-viewer/resolve-renderer";

export type FlaggedMomentRow = {
  id: string;
  documentId: string;
  timeSeconds: number | null;
  endSeconds: number | null;
  pageNumber: number | null;
  quote: string | null;
  category: string;
  description: string;
  flaggedById: string;
  flaggedByName: string | null;
  flaggedByInitials: string | null;
  createdAt: Date;
};

export type DocumentFlagGroup = {
  documentId: string;
  documentName: string;
  /** Resolved the same way the viewer picks its renderer, so the
   *  tab's per-document type icon can't disagree with what actually
   *  opens ("video" | "audio" | "pdf" | "docx" | ...). */
  renderer: DocumentRenderer;
  moments: FlaggedMomentRow[];
};

const FLAG_SELECT = {
  id: true,
  documentId: true,
  timeSeconds: true,
  endSeconds: true,
  pageNumber: true,
  quote: true,
  category: true,
  description: true,
  flaggedById: true,
  flaggedBy: { select: { name: true, initials: true } },
  createdAt: true,
} as const;

/** Anchor order shared by both loaders: time asc, then page asc,
 *  nulls last (anchorless flags sink to the bottom), createdAt
 *  tiebreak so same-anchor rows — and quote flags, which have no
 *  intrinsic order — render stably in capture order. */
const ANCHOR_ORDER = [
  { timeSeconds: { sort: "asc", nulls: "last" } },
  { pageNumber: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
] as const;

type FlagRecord = {
  id: string;
  documentId: string | null;
  timeSeconds: number | null;
  endSeconds: number | null;
  pageNumber: number | null;
  quote: string | null;
  category: string;
  description: string;
  flaggedById: string;
  flaggedBy: { name: string | null; initials: string | null };
  createdAt: Date;
};

function shapeRow(row: FlagRecord): FlaggedMomentRow {
  return {
    id: row.id,
    // Loaders join through `document`, so this is never null here.
    documentId: row.documentId ?? "",
    timeSeconds: row.timeSeconds,
    endSeconds: row.endSeconds,
    pageNumber: row.pageNumber,
    quote: row.quote,
    category: row.category,
    description: row.description,
    flaggedById: row.flaggedById,
    flaggedByName: row.flaggedBy.name,
    flaggedByInitials: row.flaggedBy.initials,
    createdAt: row.createdAt,
  };
}

/** Every flag on one document, anchor-ordered (see ANCHOR_ORDER). */
export async function getDocumentFlaggedMoments(
  documentId: string
): Promise<FlaggedMomentRow[]> {
  const rows = await prisma.flaggedMoment.findMany({
    where: { documentId },
    orderBy: [...ANCHOR_ORDER],
    select: FLAG_SELECT,
  });
  return rows.map(shapeRow);
}

/** Every flag across the matter's documents, grouped by document.
 *  Groups follow the Documents tab's name-asc walk order; flags are
 *  anchor-ordered inside each group. Documents with no flags don't
 *  produce groups. */
export async function getMatterFlaggedMoments(
  matterId: string
): Promise<DocumentFlagGroup[]> {
  const rows = await prisma.flaggedMoment.findMany({
    where: { document: { matterId } },
    orderBy: [
      { document: { name: "asc" } },
      { documentId: "asc" },
      ...ANCHOR_ORDER,
    ],
    select: {
      ...FLAG_SELECT,
      document: { select: { name: true, contentType: true } },
    },
  });

  const groups: DocumentFlagGroup[] = [];
  let current: DocumentFlagGroup | null = null;
  for (const row of rows) {
    if (!row.documentId || !row.document) continue; // evidence-side rows (defensive)
    if (!current || current.documentId !== row.documentId) {
      current = {
        documentId: row.documentId,
        documentName: row.document.name,
        renderer: resolveDocumentRenderer(
          row.document.contentType,
          row.document.name
        ),
        moments: [],
      };
      groups.push(current);
    }
    current.moments.push(shapeRow(row));
  }
  return groups;
}
