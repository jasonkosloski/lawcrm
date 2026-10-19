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
import { getLeadById, LEAD_STAGE_LABEL } from "@/lib/queries/leads";
import { getPracticeAreaOptions } from "@/lib/queries/practice-area-options";
import { requireUser } from "@/lib/current-user";
import { assertLeadAccess } from "@/lib/lead-access";
import { currentUserHasPermission } from "@/lib/permission-check";

function StageChip({ stage }: { stage: string }) {
  // DB stage values arrive untyped — fall back to the raw slug
  // for anything the label map doesn't know.
  const label = (LEAD_STAGE_LABEL as Record<string, string>)[stage] ?? stage;
  const cls =
    stage === "new"
      ? "bg-brand-soft text-brand-700 border-brand-200"
      : stage === "converted"
        ? "bg-ok-soft text-ok border-line"
        : stage === "declined"
          ? "bg-paper-2 text-ink-4 border-line"
          : stage === "hold"
            ? "bg-warn-soft text-warn border-warn-border"
            : "bg-paper-2 text-ink-3 border-line";
  return (
    <span
      className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border ${cls}`}
    >
      {label}
    </span>
  );
}

export default async function LeadDetailLayout({
  children,
  params,
}: LayoutProps<"/intake/[id]">) {
  await requireUser();
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

  return (
    <>
      <TopBar
        title={lead.displayName}
        crumbs="Intake"
        subtitle={
          <>
            <StageChip stage={lead.stage} />
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
              {canConvert && (
                <ConvertLeadButton
                  leadId={lead.id}
                  defaultMatterName={lead.displayName}
                  areas={areas}
                />
              )}
            </>
          ) : lead.convertedMatter ? (
            <Button
              size="sm"
              render={<Link href={`/matters/${lead.convertedMatter.id}`} />}
            >
              <Briefcase />
              Open matter
            </Button>
          ) : undefined
        }
      />

      <IntakeTabs leadId={lead.id} canViewRecords={canViewRecords} />

      <div className="flex-1 overflow-y-auto animate-page-enter">
        {children}
      </div>
    </>
  );
}
