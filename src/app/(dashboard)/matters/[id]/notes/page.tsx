/**
 * Matter Detail — Notes tab
 *
 * Compose + list surface for strategy memos, research notes, and
 * internal chatter on this matter. The composer sits at the top
 * (collapsed single-line → expands to full Tiptap editor on focus);
 * the list below supports search, type filter, pinned-only toggle,
 * inline pin/unpin, and delete.
 *
 * Server work: fetch + sort (pinned first, then creation order, oldest
 * first; the client reverses top-level notes and groups replies)
 * happens in `getMatterNotes`. Filtering runs client-side since a
 * matter's note set is small.
 *
 * The composer is rendered only for viewers holding `notes.create`
 * (and its pin toggle only with `notes.pin`): the create action
 * redirects denied users to "/", which would discard what they typed.
 */

import { getMatterNotes } from "@/lib/queries/matter-detail";
import { currentUserHasPermission } from "@/lib/permission-check";
import { NoteComposer } from "@/components/matters/notes/note-composer";
import { NotesTabBody } from "@/components/matters/notes/notes-tab-body";
import { requireUser } from "@/lib/current-user";

export default async function MatterNotesPage({
  params,
}: PageProps<"/matters/[id]">) {
  await requireUser();
  const { id } = await params;
  const [notes, canPin, canCreate] = await Promise.all([
    getMatterNotes(id),
    currentUserHasPermission("notes.pin"),
    currentUserHasPermission("notes.create"),
  ]);

  return (
    <div className="p-5 flex flex-col gap-4">
      {canCreate && <NoteComposer matterId={id} canPin={canPin} />}
      <NotesTabBody notes={notes} matterId={id} />
    </div>
  );
}
