/**
 * Matter Detail — Notes tab
 *
 * Compose + list surface for strategy memos, research notes, and
 * internal chatter on this matter. The composer sits at the top
 * (collapsed single-line → expands to full Tiptap editor on focus);
 * the list below supports search, type filter, pinned-only toggle,
 * inline pin/unpin, and delete.
 *
 * Server work: fetch + sort (pinned first, then most-recently updated)
 * happens in `getMatterNotes`. Filtering runs client-side since a
 * matter's note set is small.
 */

import { getMatterNotes } from "@/lib/queries/matter-detail";
import { NoteComposer } from "@/components/matters/notes/note-composer";
import { NotesTabBody } from "@/components/matters/notes/notes-tab-body";

export default async function MatterNotesPage({
  params,
}: PageProps<"/matters/[id]">) {
  const { id } = await params;
  const notes = await getMatterNotes(id);

  return (
    <div className="p-5 flex flex-col gap-4">
      <NoteComposer matterId={id} />
      <NotesTabBody notes={notes} />
    </div>
  );
}
