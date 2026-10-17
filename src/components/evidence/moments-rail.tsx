/**
 * Moments rail — the flag list beside/below the viewer body in the
 * document viewer, for every anchor kind. Flags arrive
 * server-fetched (anchor-ordered) via ReviewPanel; clicking a row
 * hands the flag to the renderer adapter's `onNavigate` (seek /
 * page jump / quote highlight). Anchorless flags — and any kind the
 * current renderer can't navigate — render as plain rows.
 *
 * Row anatomy: category chip · anchor label (`flagAnchorLabel` —
 * mm:ss / p. N / “quote…” / Document) · note · flagger initials.
 * The kebab shows Edit/Delete for the flag's creator always, and
 * for holders of the corresponding evidence.flag.*_any keys on
 * other people's flags (the server action re-checks — the client
 * flags only drive affordances).
 *
 * Editing swaps the row for the shared FlagComposer inline; delete
 * confirms (hard delete, no undo) then fires the action — whose
 * revalidatePath response re-renders the server list, so there is no
 * client-side router.refresh() (it would render the viewer twice).
 * A failed or rejected delete shows an inline message; a "Flag not found"
 * result (flag already deleted elsewhere) also refreshes the route so
 * the stale row goes away.
 */

"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Flag, MoreVertical, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteFlaggedMoment } from "@/app/actions/flagged-moments";
import {
  FLAG_NOT_FOUND,
  flagAnchorKind,
  flagAnchorLabel,
} from "@/lib/flag-anchor";
import { FlagCategoryChip } from "./flag-category-chip";
import { FlagComposer, type ComposerFlag } from "./flag-composer";

export type RailMoment = ComposerFlag & {
  flaggedById: string;
  flaggedByInitials: string | null;
  flaggedByName: string | null;
};

export function MomentsRail({
  documentId,
  moments,
  currentUserId,
  canEditAny,
  canDeleteAny,
  onNavigate,
  getCurrentTime,
  emptyHint,
}: {
  documentId: string;
  moments: RailMoment[];
  currentUserId: string;
  canEditAny: boolean;
  canDeleteAny: boolean;
  /** Renderer adapter's "go to this anchor". Undefined = this
   *  renderer can't navigate (image/fallback — anchorless only). */
  onNavigate?: (moment: RailMoment) => void;
  /** Passed through to the inline edit composer's clock buttons
   *  (media renderers only). */
  getCurrentTime?: () => number | null;
  /** Renderer-specific line under "No flags yet". */
  emptyHint: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const remove = (m: RailMoment) => {
    // Hard delete, no undo — confirm first, naming whose note goes.
    const own = m.flaggedById === currentUserId;
    if (
      !confirm(
        own
          ? "Delete this flag? This can't be undone."
          : `Delete ${m.flaggedByName ?? "another reviewer"}'s flag? This can't be undone.`,
      )
    ) {
      return;
    }
    setDeleteError(null);
    setDeletingId(m.id);
    startTransition(async () => {
      try {
        // The action revalidates the viewer + Evidence paths and its
        // response carries the re-rendered route — no router.refresh().
        const res = await deleteFlaggedMoment(m.id);
        if (!res.ok) {
          setDeleteError(res.error ?? "Couldn't delete the flag.");
          // Already gone (a colleague deleted it): nothing was
          // revalidated, so re-read the route to drop the stale row.
          if (res.error === FLAG_NOT_FOUND) router.refresh();
        }
      } catch (err) {
        unstable_rethrow(err); // redirects / not-found are not failures
        console.error("Flag delete failed", err);
        setDeleteError(
          "Couldn't delete the flag — check your connection and try again.",
        );
      } finally {
        setDeletingId(null);
      }
    });
  };

  if (moments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-line-2 px-4 py-6 text-center">
        <Flag size={16} className="text-ink-4" aria-hidden />
        <div className="text-xs font-medium text-ink-2">No flags yet</div>
        <div className="text-2xs text-ink-4">{emptyHint}</div>
      </div>
    );
  }

  return (
    <>
      {deleteError && (
        <div role="alert" className="mb-1.5 text-2xs text-warn">
          {deleteError}
        </div>
      )}
      <ul className="flex flex-col gap-1.5">
        {moments.map((m) => {
          const own = m.flaggedById === currentUserId;
          const mayEdit = own || canEditAny;
          const mayDelete = own || canDeleteAny;
          const label = flagAnchorLabel(m);
          // Anchorless flags have nowhere to go; anchored ones need
          // the renderer to know how (a quote flag on a docx whose
          // conversion failed renders as a plain row, not a dead link).
          const navigable = onNavigate && flagAnchorKind(m) !== "document";

          if (editingId === m.id) {
            return (
              <li key={m.id}>
                <FlagComposer
                  documentId={documentId}
                  editing={m}
                  createAnchor={null}
                  getCurrentTime={getCurrentTime}
                  onClose={() => setEditingId(null)}
                />
              </li>
            );
          }

          const rowBody = (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <FlagCategoryChip category={m.category} />
                <span className="min-w-0 truncate font-mono text-2xs text-brand-700">
                  {label}
                </span>
              </div>
              <div className="mt-1 text-xs leading-snug text-ink-2">
                {m.description}
              </div>
            </>
          );

          return (
            <li
              key={m.id}
              className="group flex items-start gap-2 rounded-lg border border-line bg-white p-2.5 transition-colors hover:border-brand-300"
            >
              {navigable ? (
                <button
                  type="button"
                  onClick={() => onNavigate(m)}
                  title={`Go to ${label}`}
                  className="min-w-0 flex-1 text-left"
                >
                  {rowBody}
                </button>
              ) : (
                <div className="min-w-0 flex-1">{rowBody}</div>
              )}

              <div className="flex shrink-0 items-center gap-1">
                <span
                  title={m.flaggedByName ?? undefined}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-paper-2 text-3xs font-medium text-ink-3 border border-line"
                >
                  {m.flaggedByInitials ?? "—"}
                </span>
                {(mayEdit || mayDelete) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-4 transition-colors hover:bg-paper-2 hover:text-ink-2"
                      aria-label="Flag actions"
                    >
                      <MoreVertical className="h-3.5 w-3.5" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {mayEdit && (
                        <DropdownMenuItem onClick={() => setEditingId(m.id)}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          Edit
                        </DropdownMenuItem>
                      )}
                      {mayDelete && (
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={deletingId === m.id}
                          onClick={() => remove(m)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          {deletingId === m.id ? "Deleting…" : "Delete"}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
