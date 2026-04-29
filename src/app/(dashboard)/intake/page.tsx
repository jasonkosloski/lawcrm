/**
 * Intake Queue Page
 *
 * Lists leads in a single sortable-looking table. Active leads
 * (non-converted, non-declined) surface at the top, ordered by score
 * desc — the most promising leads lead the list.
 *
 * Phase 3 v1: basic table. Follow-ups: split-view reader pane, stage
 * filter chips, lead scoring deep-dive, conflict-check details,
 * conversion wizard.
 */

import Link from "next/link";
import { Plus } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getLeadSummary,
  LEAD_SOURCE_LABEL,
  LEAD_STAGE_LABEL,
  listLeads,
  type LeadListRow,
} from "@/lib/queries/leads";

const ASSESSMENT_LABEL: Record<string, string> = {
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak",
};

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-2xs text-ink-4">—</span>;
  const cls =
    score >= 75
      ? "bg-ok-soft text-ok border-line"
      : score >= 55
        ? "bg-brand-soft text-brand-700 border-brand-200"
        : "bg-paper-2 text-ink-3 border-line";
  return (
    <span
      className={`inline-block text-xs font-mono font-semibold px-2 py-0.5 rounded-full border ${cls}`}
    >
      {score}
    </span>
  );
}

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

function ConflictDot({ status }: { status: string }) {
  if (status === "clear")
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-ink-3">
        <span className="w-1.5 h-1.5 rounded-full bg-ok" />
        Clear
      </span>
    );
  if (status === "pending")
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-ink-3">
        <span className="w-1.5 h-1.5 rounded-full bg-ink-4" />
        Pending
      </span>
    );
  if (status === "warn")
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-warn font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-warn" />
        Warn
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-2xs font-medium text-danger">
      <span className="w-1.5 h-1.5 rounded-full bg-danger" />
      Conflict
    </span>
  );
}

function SourceLabel({ source, detail }: { source: string | null; detail: string | null }) {
  if (!source) return <span className="text-2xs text-ink-4">—</span>;
  return (
    <span className="text-2xs text-ink-3">
      {LEAD_SOURCE_LABEL[source] ?? source}
      {detail && <span className="text-ink-4"> · {detail}</span>}
    </span>
  );
}

function AssessmentBadges({ row }: { row: LeadListRow }) {
  if (!row.liabilityAssessment && !row.damagesAssessment)
    return <span className="text-2xs text-ink-4">—</span>;
  return (
    <div className="flex items-center gap-1 text-2xs text-ink-3">
      {row.liabilityAssessment && (
        <span title="Liability">
          L:{" "}
          <span className="text-ink font-medium">
            {ASSESSMENT_LABEL[row.liabilityAssessment] ?? row.liabilityAssessment}
          </span>
        </span>
      )}
      {row.damagesAssessment && (
        <span title="Damages">
          · D:{" "}
          <span className="text-ink font-medium">
            {ASSESSMENT_LABEL[row.damagesAssessment] ?? row.damagesAssessment}
          </span>
        </span>
      )}
    </div>
  );
}

export default async function IntakePage() {
  const [leads, summary] = await Promise.all([listLeads(), getLeadSummary()]);

  // Sort: active leads first (score desc), then inactive (by createdAt desc).
  const sorted = [...leads].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (a.isActive) {
      const aScore = a.score ?? -1;
      const bScore = b.score ?? -1;
      return bScore - aScore;
    }
    return 0;
  });

  const crumbBits = [
    `${summary.activeCount} active`,
    summary.newTodayCount > 0 ? `${summary.newTodayCount} new today` : null,
    summary.conflictCount > 0 ? `${summary.conflictCount} conflict` : null,
    summary.convertedCount > 0 ? `${summary.convertedCount} converted` : null,
  ].filter(Boolean);

  return (
    <>
      <TopBar
        title="Intake"
        crumbs={crumbBits.join(" · ")}
        actions={
          <Button size="sm" render={<Link href="/intake/new" />}>
            <Plus />
            New intake
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-3 sm:p-5 animate-page-enter">
        {/* Mobile: card stack. The 8-col leads table doesn't
            survive a phone, so we collapse to one card per lead
            with the most-glanceable bits (name, source, score,
            statute warning, stage). Tablet+ keeps the table. */}
        <ul className="md:hidden flex flex-col gap-2">
          {sorted.length === 0 ? (
            <li className="rounded border border-line bg-card p-6 text-center text-xs text-ink-4">
              No leads yet — new inquiries will show up here.
            </li>
          ) : (
            sorted.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/intake/${lead.id}`}
                  className="block rounded border border-line bg-card p-3 hover:border-brand-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">
                        {lead.name}
                      </div>
                      {lead.summary && (
                        <div className="text-2xs text-ink-3 line-clamp-2 mt-0.5">
                          {lead.summary}
                        </div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap mt-1.5">
                        <StageChip stage={lead.stage} />
                        <SourceLabel
                          source={lead.source}
                          detail={lead.sourceDetail}
                        />
                        <ConflictDot status={lead.conflictCheck} />
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <ScoreBadge score={lead.score} />
                      {lead.statuteWindow !== null && (
                        <span
                          className={
                            "font-mono text-2xs " +
                            (lead.statuteWindow <= 30
                              ? "text-warn font-medium"
                              : "text-ink-3")
                          }
                        >
                          {lead.statuteWindow}d
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))
          )}
        </ul>

        <Card className="p-0 overflow-hidden hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Lead</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-center">Score</TableHead>
                <TableHead>Assessment</TableHead>
                <TableHead className="text-right">Statute</TableHead>
                <TableHead>Conflict</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right pr-4">Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-xs text-ink-4">
                    No leads yet — new inquiries will show up here.
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((lead) => (
                  <TableRow key={lead.id} className="cursor-pointer">
                    <TableCell className="pl-4">
                      <Link
                        href={`/intake/${lead.id}`}
                        className="flex flex-col gap-0.5 hover:text-brand-700"
                      >
                        <span className="font-medium text-ink">{lead.name}</span>
                        {lead.summary && (
                          <span className="text-2xs text-ink-3 truncate max-w-md">
                            {lead.summary}
                          </span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <SourceLabel source={lead.source} detail={lead.sourceDetail} />
                    </TableCell>
                    <TableCell className="text-center">
                      <ScoreBadge score={lead.score} />
                    </TableCell>
                    <TableCell>
                      <AssessmentBadges row={lead} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-2xs">
                      {lead.statuteWindow === null ? (
                        <span className="text-ink-4">—</span>
                      ) : lead.statuteWindow <= 30 ? (
                        <span className="text-warn font-medium">
                          {lead.statuteWindow}d
                        </span>
                      ) : (
                        <span className="text-ink-3">{lead.statuteWindow}d</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ConflictDot status={lead.conflictCheck} />
                    </TableCell>
                    <TableCell>
                      <StageChip stage={lead.stage} />
                    </TableCell>
                    <TableCell className="text-right pr-4 font-mono text-2xs text-ink-3">
                      {lead.ageDays === 0 ? "today" : `${lead.ageDays}d`}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
