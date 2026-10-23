/**
 * Lead Detail Layout
 *
 * Shared TopBar + tab bar around every lead detail tab (Overview,
 * Communication). Fetches the lead once for the header so each tab
 * doesn't re-fetch, and keeps lead-level actions (Decline / Convert)
 * always-visible regardless of which tab is active.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { IntakeTabs } from "@/components/intake/intake-tabs";
import { ConvertLeadButton } from "@/components/intake/convert-lead-button";
import { DeclineLeadButton } from "@/components/intake/decline-lead-button";
import { getLeadById } from "@/lib/queries/leads";
import { getPracticeAreaOptions } from "@/lib/queries/practice-area-options";
import { prisma } from "@/lib/prisma";
import { attorneyUserWhere, defaultLeadAttorneyId } from "@/lib/attorneys";
import { dateOnlyKey } from "@/lib/format-date";
import { todayDateOnly } from "@/app/actions/billing/helpers";
import { requireUser } from "@/lib/current-user";
import { assertLeadAccess } from "@/lib/lead-access";
import { currentUserHasPermission } from "@/lib/permission-check";
import { RestrictedBadge } from "@/components/shared/restricted-badge";
import { LeadStageChip } from "@/components/intake/lead-stage-chip";

async function loadEngagementInputs(leadId: string, userId: string) {
  const [documents, firm, today, attorneys] = await Promise.all([
    prisma.document.findMany({
      where: { leadId, status: { not: "archived" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { firm: { select: { requireOriginatingDoc: true } } },
    }),
    todayDateOnly(),
    prisma.user.findMany({
      where: attorneyUserWhere,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    attorneys,
    documents,
    requireOriginatingDoc: firm?.firm?.requireOriginatingDoc ?? false,
    todayKey: dateOnlyKey(today),
  };
}

export default async function LeadDetailLayout({ children, params }: LayoutProps<"/intake/[id]">) {
  const userId = await requireUser();
  const { id } = await params;
  await assertLeadAccess(id);
  // Hide the lead-level actions the viewer's role can't use — the
  // server actions still gate, but a refused click just bounces to "/"
  // after the user has typed into the dialog. Convert creates a Matter
  // (matters.create); Decline has its own key.
  const [lead, areas, canConvert, canDecline, canViewRecords] = await Promise.all([
    getLeadById(id),
    getPracticeAreaOptions(),
    currentUserHasPermission("matters.create"),
    currentUserHasPermission("intake.decline"),
    currentUserHasPermission("records.view"),
  ]);
  if (!lead) notFound();

  const isResolved = lead.stage === "converted" || lead.stage === "declined";
  // Engagement block of the convert dialog: the lead's live documents
  // (assertLeadAccess above already scoped the viewer to this lead) and
  // the firm's signed-document switch. Only loaded when the button renders.
  const engagement = canConvert && !isResolved ? await loadEngagementInputs(id, userId) : null;

  return (
    <>
      <TopBar
        title={lead.displayName}
        subtitle={
          <>
            <LeadStageChip stage={lead.stage} />
            {lead.restricted && <RestrictedBadge />}
            {lead.score !== null && (
              <span className="text-2xs font-mono font-semibold text-ink-3">
                Score {lead.score}
              </span>
            )}
          </>
        }
        actions={
          !isResolved ? (
            <>
              {canDecline && <DeclineLeadButton leadId={lead.id} />}
              {canConvert && engagement && (
                <ConvertLeadButton
                  leadId={lead.id}
                  defaultMatterName={lead.displayName}
                  areas={areas}
                  documents={engagement.documents}
                  requireOriginatingDoc={engagement.requireOriginatingDoc}
                  todayKey={engagement.todayKey}
                  attorneys={engagement.attorneys}
                  defaultLeadAttorneyId={defaultLeadAttorneyId(
                    userId,
                    lead.teamMembers.map((m) => m.userId),
                    engagement.attorneys.map((a) => a.id),
                  )}
                  restrictedTo={
                    lead.restricted ? lead.teamMembers.map((m) => m.user.name) : undefined
                  }
                />
              )}
            </>
          ) : lead.convertedMatter ? (
            <Button size="sm" render={<Link href={`/matters/${lead.convertedMatter.id}`} />}>
              <Briefcase />
              Open matter
            </Button>
          ) : undefined
        }
      />

      <IntakeTabs leadId={lead.id} canViewRecords={canViewRecords} />

      <div className="flex-1 overflow-y-auto animate-page-enter">{children}</div>
    </>
  );
}
