/**
 * Lead Detail — Documents tab
 *
 * The shared documents browser scoped to the lead (`Document.leadId`):
 * intake paperwork, correspondence and generated documents before a
 * matter exists. Same folders, uploads and templates, same documents.*
 * permissions; leads have no matter wall. On conversion every document
 * and folder re-homes onto the new matter, so a converted lead's tab is
 * read-only and points there.
 */

import Link from "next/link";
import { Briefcase } from "lucide-react";
import { DocumentsBrowser } from "@/components/documents/documents-browser";
import { requireUser } from "@/lib/current-user";
import { assertLeadAccess } from "@/lib/lead-access";
import { prisma } from "@/lib/prisma";

export default async function LeadDocumentsPage({
  params,
  searchParams,
}: PageProps<"/intake/[id]/documents">) {
  // Pages guard themselves: layouts don't re-run on soft navigation (ADR-028).
  await requireUser();
  const { id } = await params;
  await assertLeadAccess(id);
  const sp = await searchParams;
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { stage: true, convertedMatterId: true },
  });
  // The layout notFound()s missing leads.
  if (!lead) return null;
  const isConverted = lead.stage === "converted";

  return (
    <>
      {isConverted && (
        <div className="px-5 pt-5">
          <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper-2 px-3 py-2.5">
            <p className="text-xs text-ink-3">
              This lead converted — its intake documents were carried forward
              to the matter. Add new documents there.
            </p>
            {lead.convertedMatterId && (
              <Link
                href={`/matters/${lead.convertedMatterId}/documents`}
                className="inline-flex items-center gap-1.5 shrink-0 text-xs font-medium text-brand-700 hover:underline"
              >
                <Briefcase size={13} />
                Open matter documents
              </Link>
            )}
          </div>
        </div>
      )}
      <DocumentsBrowser
        scope={{ kind: "lead", leadId: id }}
        folderParam={typeof sp.folder === "string" ? sp.folder : null}
        writable={!isConverted}
      />
    </>
  );
}
