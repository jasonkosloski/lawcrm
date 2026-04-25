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

function StageChip({ stage }: { stage: string }) {
  const label = LEAD_STAGE_LABEL[stage] ?? stage;
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
  const { id } = await params;
  const [lead, areas] = await Promise.all([
    getLeadById(id),
    getPracticeAreaOptions(),
  ]);
  if (!lead) notFound();

  const isResolved = lead.stage === "converted" || lead.stage === "declined";

  return (
    <>
      <TopBar
        title={lead.name}
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
              <DeclineLeadButton leadId={lead.id} />
              <ConvertLeadButton
                leadId={lead.id}
                defaultMatterName={lead.name}
                areas={areas}
              />
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

      <IntakeTabs leadId={lead.id} />

      <div className="flex-1 overflow-y-auto animate-page-enter">
        {children}
      </div>
    </>
  );
}
