/**
 * Matter Detail — Notes tab
 *
 * Compose + list surface for strategy memos, research notes, and
 * internal chatter on this matter. The composer sits at the top
 * (collapsed single-line → expands to full Tiptap editor on focus);
 * the list below supports search, type filter, pinned-only toggle,
 * inline pin/unpin, and delete.
 *
 * Server work: fetch + sort (pinned first, then oldest-first by
 * creation time) happens in `getMatterNotes`; the client groups the
 * flat list into threads. Filtering runs client-side since a matter's
 * note set is small.
 *
 * The viewer's permissions are resolved once here (`getNoteAccess`)
 * and passed down, so a control the viewer can't use is never shown —
 * using one would redirect to the dashboard and lose what they typed.
 */

import { getMatterNotes } from "@/lib/queries/matter-detail";
import { getNoteAccess } from "@/lib/note-access";
import { allowedCaptureKinds } from "@/lib/note-constants";
import { NoteComposer } from "@/components/matters/notes/note-composer";
import { NotesTabBody } from "@/components/matters/notes/notes-tab-body";
import { requireUser } from "@/lib/current-user";
import { assertMatterAccess } from "@/lib/matter-access";

export default async function MatterNotesPage({
  params,
}: PageProps<"/matters/[id]">) {
  await requireUser();
  const { id } = await params;
  await assertMatterAccess(id);
  const [notes, access] = await Promise.all([
    getMatterNotes(id),
    getNoteAccess(),
  ]);

  return (
    <div className="p-5 flex flex-col gap-4">
      {access.canCreateNote && (
        <NoteComposer
          matterId={id}
          canPin={access.canPin}
          allowedKinds={allowedCaptureKinds(access, [
            "task",
            "event",
            "deadline",
            "time",
          ])}
        />
      )}
      <NotesTabBody notes={notes} matterId={id} access={access} />
    </div>
  );
}
