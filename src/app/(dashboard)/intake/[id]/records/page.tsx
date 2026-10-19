/**
 * Lead Detail — Records tab. Same tab as the matter's; a converted
 * lead's requests moved onto the matter, so it points there and the
 * tab goes read-only.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase } from "lucide-react";
import { RecordsTab } from "@/components/records-requests/records-tab";
import { requireUser } from "@/lib/current-user";
import { assertLeadAccess } from "@/lib/lead-access";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";

export default async function LeadRecordsPage({
  params,
}: PageProps<"/intake/[id]/records">) {
  await requireUser();
  const { id } = await params;
  await assertLeadAccess(id);
  const [lead, canView] = await Promise.all([
    prisma.lead.findUnique({
      where: { id },
      select: { stage: true, convertedMatterId: true },
    }),
    currentUserHasPermission("records.view"),
  ]);
  if (!lead || !canView) notFound();
  const isConverted = lead.stage === "converted";

  return (
    <div className="p-5 flex flex-col gap-5">
      {isConverted && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper-2 px-3 py-2.5">
          <p className="text-xs text-ink-3">
            This lead converted — its records requests were carried forward to
            the matter. Add new requests there.
          </p>
          {lead.convertedMatterId && (
            <Link
              href={`/matters/${lead.convertedMatterId}/records`}
              className="inline-flex items-center gap-1.5 shrink-0 text-xs font-medium text-brand-700 hover:underline"
            >
              <Briefcase size={13} />
              Open matter records
            </Link>
          )}
        </div>
      )}
      <RecordsTab
        scope={{ kind: "lead", leadId: id }}
        writable={!isConverted}
      />
    </div>
  );
}
