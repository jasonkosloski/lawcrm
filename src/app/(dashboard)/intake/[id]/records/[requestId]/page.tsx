/**
 * Intake Records — one request's detail page. records.view gate; a
 * converted lead's requests moved to the matter, so it shows the
 * banner pointing there and the page goes read-only.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase } from "lucide-react";
import { RequestDetailPage } from "@/components/records-requests/request-detail-page";
import { requireUser } from "@/lib/current-user";
import { assertLeadAccess } from "@/lib/lead-access";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";

export default async function LeadRecordsRequestPage({
  params,
}: PageProps<"/intake/[id]/records/[requestId]">) {
  await requireUser();
  const { id, requestId } = await params;
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
      <RequestDetailPage
        scope={{ kind: "lead", leadId: id }}
        requestId={requestId}
        writable={!isConverted}
      />
    </div>
  );
}
