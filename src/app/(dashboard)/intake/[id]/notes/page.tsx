/**
 * Lead Detail — Notes tab
 *
 * The lead-scoped mirror of the matter Notes tab: intake notes
 * (screening-call notes, evaluation thoughts, follow-up chatter)
 * written against the lead via `Note.leadId` before a matter exists.
 * Same composer + threaded list, same notes.* permissions. Matter-only
 * features are left out — no captured tasks / deadlines / events /
 * time, no Convert to task — since those need a matter.
 *
 * On conversion every note re-homes onto the new matter
 * (convertLeadToMatter), threads and reactions intact, and this tab
 * points there instead.
 */

import Link from "next/link";
import { Briefcase } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getLeadNotes } from "@/lib/queries/matter-detail";
import { getNoteAccess } from "@/lib/note-access";
import { NoteComposer } from "@/components/matters/notes/note-composer";
import { NotesTabBody } from "@/components/matters/notes/notes-tab-body";
import { requireUser } from "@/lib/current-user";

export default async function LeadNotesPage({
  params,
}: PageProps<"/intake/[id]/notes">) {
  await requireUser();
  const { id } = await params;
  const [lead, notes, access] = await Promise.all([
    // Stage decides whether the composer renders: a converted lead's
    // notes already moved to the matter (createLeadNote refuses it).
    prisma.lead.findUnique({
      where: { id },
      select: { stage: true, convertedMatterId: true },
    }),
    getLeadNotes(id),
    getNoteAccess(),
  ]);
  // The layout notFound()s missing leads; render nothing if the row
  // vanished between the layout's fetch and ours.
  if (!lead) return null;

  const isConverted = lead.stage === "converted";
  const scope = { kind: "lead", leadId: id } as const;

  return (
    <div className="p-5 flex flex-col gap-4">
      {isConverted ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper-2 px-3 py-2.5">
          <p className="text-xs text-ink-3">
            This lead converted — its intake notes were carried forward to
            the matter. Write new notes there.
          </p>
          {lead.convertedMatterId && (
            <Link
              href={`/matters/${lead.convertedMatterId}/notes`}
              className="inline-flex items-center gap-1.5 shrink-0 text-xs font-medium text-brand-700 hover:underline"
            >
              <Briefcase size={13} />
              Open matter notes
            </Link>
          )}
        </div>
      ) : (
        access.canCreateNote && (
          <NoteComposer scope={scope} canPin={access.canPin} allowedKinds={[]} />
        )
      )}
      <NotesTabBody
        notes={notes}
        scope={scope}
        // Nothing to reply to on a converted lead, and createLeadNote
        // would refuse it anyway.
        access={isConverted ? { ...access, canCreateNote: false } : access}
      />
    </div>
  );
}
