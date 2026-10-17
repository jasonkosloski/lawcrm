/**
 * Viewer context for the notes / time-entry sections of an event.
 *
 * The same two sections render in the calendar's event modal and on
 * the matter Events tab. Both need to know what the viewer may do so
 * they can HIDE buttons the server would refuse — a denied
 * `requirePermission` redirects to `/` with no message, which dumps
 * the user out of the calendar. Rather than thread four props through
 * every wrapper, the page that resolves the permissions wraps the
 * surface in `EventAttachmentsProvider`.
 *
 * With no provider the defaults are permissive (the server stays the
 * authority) so a surface that hasn't been wired yet behaves as it
 * always did.
 */

"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

export type EventAttachmentsViewer = {
  /** The signed-in user's id, to recognise their own notes / entries
   *  (authors may delete their own without `*.delete_any`). */
  viewerId: string | null;
  /** `notes.pin` — toggling a pin has no author bypass. */
  canPinNotes: boolean;
  /** `notes.delete_any` — deleting someone else's note. */
  canDeleteAnyNote: boolean;
  /** `time_entries.delete_any` — deleting someone else's entry. */
  canDeleteAnyTimeEntry: boolean;
  /** `YYYY-MM-DD` the "log time" composer starts on (the event's
   *  date). Null = the viewer's today. */
  defaultTimeEntryDate: string | null;
};

const PERMISSIVE: EventAttachmentsViewer = {
  viewerId: null,
  canPinNotes: true,
  canDeleteAnyNote: true,
  canDeleteAnyTimeEntry: true,
  defaultTimeEntryDate: null,
};

const EventAttachmentsContext =
  createContext<EventAttachmentsViewer>(PERMISSIVE);

export function EventAttachmentsProvider({
  viewerId,
  canPinNotes,
  canDeleteAnyNote,
  canDeleteAnyTimeEntry,
  defaultTimeEntryDate,
  children,
}: Partial<EventAttachmentsViewer> & { children: ReactNode }) {
  const value = useMemo<EventAttachmentsViewer>(
    () => ({
      viewerId: viewerId ?? PERMISSIVE.viewerId,
      canPinNotes: canPinNotes ?? PERMISSIVE.canPinNotes,
      canDeleteAnyNote: canDeleteAnyNote ?? PERMISSIVE.canDeleteAnyNote,
      canDeleteAnyTimeEntry:
        canDeleteAnyTimeEntry ?? PERMISSIVE.canDeleteAnyTimeEntry,
      defaultTimeEntryDate:
        defaultTimeEntryDate ?? PERMISSIVE.defaultTimeEntryDate,
    }),
    [
      viewerId,
      canPinNotes,
      canDeleteAnyNote,
      canDeleteAnyTimeEntry,
      defaultTimeEntryDate,
    ]
  );
  return (
    <EventAttachmentsContext.Provider value={value}>
      {children}
    </EventAttachmentsContext.Provider>
  );
}

export function useEventAttachmentsViewer(): EventAttachmentsViewer {
  return useContext(EventAttachmentsContext);
}

/**
 * Whether the viewer may delete a record authored by `authorId`.
 * Their own: always. Someone else's: needs the `delete_any` key.
 * An unknown author (rows from a query that doesn't carry it) is
 * left to the server.
 */
export function canDeleteRecord(
  authorId: string | undefined,
  viewerId: string | null,
  canDeleteAny: boolean
): boolean {
  if (canDeleteAny) return true;
  if (authorId === undefined || viewerId === null) return true;
  return authorId === viewerId;
}
