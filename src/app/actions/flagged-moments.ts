/**
 * Flagged-moment server actions — evidence review v2.
 *
 * A FlaggedMoment is a reviewer's bookmark on a Document, anchored
 * in AT MOST ONE of three ways matched to the document's renderer
 * type, plus a category from the curated catalog
 * (`src/lib/constants/flag-category.ts`) and a short note:
 *
 *   media (audio/video)  — `timeSeconds` point or
 *                          `timeSeconds`–`endSeconds` span
 *   pdf                  — `pageNumber` (1-based)
 *   rendered text        — `quote` (captured selection),
 *   (docx/text/csv)        relocated by scroll-to-highlight
 *   everything viewable  — anchorless: flags the document as a whole
 *                          (the ONLY kind image / legacy-.doc /
 *                          unsupported files accept)
 *
 * The renderer check reuses `resolveDocumentRenderer` so "which
 * anchor fits this file?" has exactly one definition — the action
 * and the viewer can't disagree.
 *
 * Anchor kinds are immutable after create: `updateFlaggedMoment`
 * edits values WITHIN a kind (move the timestamp, fix the page,
 * re-capture the quote) but rejects kind switches. A different
 * anchor kind is a different fact about the evidence — reviewers
 * delete and re-flag rather than silently morphing a "moment at
 * 1:15" into a "page 12" while keeping its id, history, and note.
 *
 * Auth (mirrors the notes.ts ownership pattern):
 *   - createFlaggedMoment: `evidence.flag.create`
 *   - updateFlaggedMoment: creator bypass + `evidence.flag.edit_any`
 *     for crossing ownership
 *   - deleteFlaggedMoment: creator bypass + `evidence.flag.delete_any`
 *
 * Activity log: create + delete write `type: "evidence"` entries so
 * the matter Timeline reflects review work. Edits are not logged —
 * same posture as note edits.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { FLAG_CATEGORIES } from "@/lib/constants/flag-category";
import { MAX_MEDIA_SECONDS } from "@/lib/media-time";
import {
  MAX_PDF_PAGE,
  MAX_QUOTE_CHARS,
  flagAnchorKind,
  flagAnchorLabel,
  type FlagAnchorKind,
} from "@/lib/flag-anchor";
import {
  resolveDocumentRenderer,
  type DocumentRenderer,
} from "@/components/documents-viewer/resolve-renderer";

export type FlagActionResult = {
  ok: boolean;
  error?: string;
  /** The created row's id (create only) so the client can highlight it. */
  id?: string;
};

/** Shared field schema for create + update. The anchor fields are
 *  all optional — none set = an anchorless whole-document flag; the
 *  at-most-one-kind and endSeconds-ordering invariants live in
 *  `superRefine` so each error lands on the right field. Times are
 *  numbers of seconds (the client parses mm:ss before submitting —
 *  see `src/lib/media-time.ts`). */
const flagSchema = z
  .object({
    timeSeconds: z
      .number()
      .finite()
      .min(0, "Time can't be negative")
      .max(MAX_MEDIA_SECONDS, "Time is past the 24h cap")
      .optional(),
    endSeconds: z
      .number()
      .finite()
      .min(0, "End time can't be negative")
      .max(MAX_MEDIA_SECONDS, "End time is past the 24h cap")
      .optional(),
    pageNumber: z
      .number()
      .int("Page must be a whole number")
      .min(1, "Pages start at 1")
      .max(MAX_PDF_PAGE, `Page can't exceed ${MAX_PDF_PAGE}`)
      .optional(),
    quote: z
      .string()
      .trim()
      .min(1, "The quoted selection can't be empty")
      .max(MAX_QUOTE_CHARS, `Keep the quote under ${MAX_QUOTE_CHARS} characters`)
      .optional(),
    category: z.enum(FLAG_CATEGORIES),
    description: z
      .string()
      .trim()
      .min(1, "Add a short note about the moment")
      .max(500, "Keep the note under 500 characters"),
  })
  .superRefine((val, ctx) => {
    const kinds = [
      val.timeSeconds !== undefined,
      val.pageNumber !== undefined,
      val.quote !== undefined,
    ].filter(Boolean).length;
    if (kinds > 1) {
      ctx.addIssue({
        code: "custom",
        message:
          "A flag carries at most one anchor kind — time, page, or quote",
      });
    }
    if (val.endSeconds !== undefined && val.timeSeconds === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["endSeconds"],
        message: "A span end needs a start time",
      });
    }
    if (
      val.endSeconds !== undefined &&
      val.timeSeconds !== undefined &&
      val.endSeconds <= val.timeSeconds
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["endSeconds"],
        message: "Span end must be after the start time",
      });
    }
  });

export type FlagInput = z.input<typeof flagSchema>;

type ParsedFlag = z.output<typeof flagSchema>;

/** First issue message, for the single-string result shape. */
function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid flag";
}

/** Anchor kind of a validated input (undefined fields = absent). */
function inputAnchorKind(data: ParsedFlag): FlagAnchorKind {
  return flagAnchorKind({
    timeSeconds: data.timeSeconds ?? null,
    pageNumber: data.pageNumber ?? null,
    quote: data.quote ?? null,
  });
}

/** The one ANCHORED kind each renderer accepts ("document" —
 *  anchorless — is accepted by every renderer and isn't listed). */
const RENDERER_ANCHOR_KIND: Partial<Record<DocumentRenderer, FlagAnchorKind>> =
  {
    video: "time",
    audio: "time",
    pdf: "page",
    docx: "quote",
    text: "quote",
    csv: "quote",
    // image / doc_legacy / unsupported: anchorless only.
  };

/** null = the anchor fits this document; string = user-facing error. */
function anchorFitError(
  renderer: DocumentRenderer,
  kind: FlagAnchorKind
): string | null {
  if (kind === "document") return null; // anchorless flags any document
  const allowed = RENDERER_ANCHOR_KIND[renderer];
  if (allowed === kind) return null;
  switch (allowed) {
    case "time":
      return "Recordings anchor by timestamp — capture a moment or flag the whole recording.";
    case "page":
      return "PDFs anchor by page number — enter a page or flag the whole document.";
    case "quote":
      return "This document anchors by quoted text — select a passage or flag the whole document.";
    default:
      return "This file type has no inline anchors — flag the document as a whole.";
  }
}

/** The four anchor columns as write-ready values. */
function anchorData(data: ParsedFlag) {
  return {
    timeSeconds: data.timeSeconds ?? null,
    endSeconds: data.endSeconds ?? null,
    pageNumber: data.pageNumber ?? null,
    quote: data.quote ?? null,
  };
}

// ── Create ──────────────────────────────────────────────────────────────

export async function createFlaggedMoment(
  documentId: string,
  input: FlagInput
): Promise<FlagActionResult> {
  const userId = await requirePermission("evidence.flag.create");

  const parsed = flagSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  // The document must exist AND the anchor kind must fit its
  // renderer. Renderer resolution (contentType first, extension
  // fallback) is the same pure function the viewer uses, so the two
  // can't disagree about what kind of anchor a file takes.
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, matterId: true, name: true, contentType: true },
  });
  if (!doc) return { ok: false, error: "Document not found" };
  const renderer = resolveDocumentRenderer(doc.contentType, doc.name);
  const kind = inputAnchorKind(parsed.data);
  const fitError = anchorFitError(renderer, kind);
  if (fitError) return { ok: false, error: fitError };

  const anchor = anchorData(parsed.data);
  const created = await prisma.flaggedMoment.create({
    data: {
      documentId: doc.id,
      ...anchor,
      category: parsed.data.category,
      description: parsed.data.description,
      flaggedById: userId,
    },
    select: { id: true },
  });

  revalidateFlagSurfaces(doc.matterId, doc.id);
  await logActivity({
    matterId: doc.matterId,
    userId,
    type: "evidence",
    title: createTitle(kind, anchor),
    detail: `${doc.name} — ${parsed.data.description.slice(0, 80)}`,
    // Timeline icon map: "video" for recordings, "document" (file
    // glyph) for everything else.
    icon: kind === "time" ? "video" : "document",
    source: "Evidence",
  });

  return { ok: true, id: created.id };
}

/** Activity-log title for a fresh flag, per anchor kind. */
function createTitle(
  kind: FlagAnchorKind,
  anchor: {
    timeSeconds: number | null;
    endSeconds: number | null;
    pageNumber: number | null;
    quote: string | null;
  }
): string {
  switch (kind) {
    case "time":
      return `Moment flagged at ${flagAnchorLabel(anchor)}`;
    case "page":
      return `Page ${anchor.pageNumber} flagged`;
    case "quote":
      return `Passage flagged: ${flagAnchorLabel(anchor)}`;
    case "document":
      return "Document flagged";
  }
}

// ── Update ──────────────────────────────────────────────────────────────

export async function updateFlaggedMoment(
  flagId: string,
  input: FlagInput
): Promise<FlagActionResult> {
  const parsed = flagSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const flag = await prisma.flaggedMoment.findUnique({
    where: { id: flagId },
    select: {
      id: true,
      flaggedById: true,
      timeSeconds: true,
      pageNumber: true,
      quote: true,
      document: { select: { id: true, matterId: true } },
    },
  });
  if (!flag) return { ok: false, error: "Flag not found" };

  // Creator can always edit their own; otherwise gate.
  const actorId = await getCurrentUserId();
  if (flag.flaggedById !== actorId) {
    await requirePermission("evidence.flag.edit_any");
  }

  // Anchor values may move WITHIN a kind (retime, repage, requote —
  // including point↔span, which stays "time"); the kind itself is
  // immutable. A kind switch is a different fact about the evidence,
  // not an edit — delete the flag and flag the new anchor instead,
  // so the row's history never claims a page was once a timestamp.
  // (This also keeps the renderer-fit check create-only: a row's
  // kind was validated against its document when it was created.)
  const existingKind = flagAnchorKind(flag);
  const nextKind = inputAnchorKind(parsed.data);
  if (existingKind !== nextKind) {
    return {
      ok: false,
      error:
        "A flag's anchor kind can't change — delete this flag and add a new one instead.",
    };
  }

  await prisma.flaggedMoment.update({
    where: { id: flagId },
    data: {
      ...anchorData(parsed.data),
      category: parsed.data.category,
      description: parsed.data.description,
    },
  });

  if (flag.document) revalidateFlagSurfaces(flag.document.matterId, flag.document.id);
  return { ok: true };
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteFlaggedMoment(
  flagId: string
): Promise<FlagActionResult> {
  const flag = await prisma.flaggedMoment.findUnique({
    where: { id: flagId },
    select: {
      id: true,
      timeSeconds: true,
      endSeconds: true,
      pageNumber: true,
      quote: true,
      flaggedById: true,
      document: { select: { id: true, matterId: true, name: true } },
    },
  });
  if (!flag) return { ok: false, error: "Flag not found" };

  // Creator can always delete their own; otherwise gate.
  const actorId = await getCurrentUserId();
  if (flag.flaggedById !== actorId) {
    await requirePermission("evidence.flag.delete_any");
  }

  await prisma.flaggedMoment.delete({ where: { id: flagId } });

  if (flag.document) {
    revalidateFlagSurfaces(flag.document.matterId, flag.document.id);
    const kind = flagAnchorKind(flag);
    await logActivity({
      matterId: flag.document.matterId,
      userId: actorId,
      type: "evidence",
      title:
        kind === "time"
          ? `Flag removed at ${flagAnchorLabel(flag)}`
          : kind === "document"
            ? "Flag removed"
            : `Flag removed (${flagAnchorLabel(flag)})`,
      detail: flag.document.name,
      icon: kind === "time" ? "video" : "document",
      source: "Evidence",
    });
  }
  return { ok: true };
}

// ── Shared revalidation ─────────────────────────────────────────────────

/** Both read surfaces show flags: the full-page viewer's moments
 *  rail and the matter's Evidence review tab. */
function revalidateFlagSurfaces(matterId: string, documentId: string): void {
  revalidatePath(`/matters/${matterId}/documents/${documentId}`);
  revalidatePath(`/matters/${matterId}/evidence`);
}
