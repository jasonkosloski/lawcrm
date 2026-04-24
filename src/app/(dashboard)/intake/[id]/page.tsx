/**
 * Lead Detail Page
 *
 * Single-column detail view for a lead in the intake queue. Shows
 * contact, case summary, assessment + score, conflict check, and
 * timeline; primary actions (Convert to matter, Decline) are
 * placeholders for now — the conversion wizard is a Phase 3.X
 * follow-up.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Ban,
  Briefcase,
  CheckCircle2,
  Hourglass,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getLeadById,
  LEAD_SOURCE_LABEL,
  LEAD_STAGE_LABEL,
} from "@/lib/queries/leads";

const ASSESSMENT_LABEL: Record<string, string> = {
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak",
};

const formatDate = (d: Date | null): string => {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

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

function AssessmentBar({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="w-20 text-ink-4">{label}</span>
        <span className="text-ink-4">—</span>
      </div>
    );
  }
  const pct =
    value === "strong" ? "w-full" : value === "moderate" ? "w-2/3" : "w-1/3";
  const color =
    value === "strong"
      ? "bg-ok"
      : value === "moderate"
        ? "bg-brand-500"
        : "bg-warn";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-ink-4">{label}</span>
      <div className="flex-1 h-1.5 bg-paper-2 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} ${pct}`} />
      </div>
      <span className="w-16 text-right text-ink font-medium">
        {ASSESSMENT_LABEL[value] ?? value}
      </span>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: PageProps<"/intake/[id]">) {
  const { id } = await params;
  const lead = await getLeadById(id);
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
              <Button size="sm" variant="outline" disabled title="Coming soon">
                <Ban />
                Decline
              </Button>
              <Button size="sm" disabled title="Coming soon">
                <ArrowRight />
                Convert to matter
              </Button>
            </>
          ) : lead.convertedMatter ? (
            <Button
              size="sm"
              render={
                <Link href={`/matters/${lead.convertedMatter.id}`} />
              }
            >
              <Briefcase />
              Open matter
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <div className="max-w-4xl grid grid-cols-3 gap-5">
          {/* ── Left column (2/3) ─────────────────────────────────── */}
          <div className="col-span-2 flex flex-col gap-5">
            {/* Summary */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Case summary
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {lead.summary ? (
                  <p className="text-xs text-ink leading-relaxed whitespace-pre-wrap">
                    {lead.summary}
                  </p>
                ) : (
                  <p className="text-xs text-ink-4">No summary provided.</p>
                )}

                <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-xs mt-5 pt-4 border-t border-line">
                  <Field
                    icon={<MapPin size={11} />}
                    label="Location"
                    value={lead.location}
                  />
                  <Field
                    icon={<Hourglass size={11} />}
                    label="Date of incident"
                    value={formatDate(lead.dateOfIncident)}
                  />
                  <Field label="Injuries" value={lead.injuries} />
                  <Field
                    label="Prior counsel"
                    value={lead.priorCounsel ? "Yes" : "No"}
                  />
                </dl>
              </CardContent>
            </Card>

            {/* Assessment */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Assessment
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 flex flex-col gap-2.5">
                <AssessmentBar
                  label="Liability"
                  value={lead.liabilityAssessment}
                />
                <AssessmentBar
                  label="Damages"
                  value={lead.damagesAssessment}
                />
                {lead.defendantAbility && (
                  <div className="mt-2 pt-3 border-t border-line text-xs">
                    <div className="text-ink-4 mb-1">
                      Defendant's ability to pay
                    </div>
                    <div className="text-ink leading-relaxed">
                      {lead.defendantAbility}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Resolution info (if converted or declined) */}
            {lead.stage === "converted" && lead.convertedMatter && (
              <Card className="border-ok-soft">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-ok" />
                    Converted to matter
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <Link
                    href={`/matters/${lead.convertedMatter.id}`}
                    className="flex items-center gap-2 text-xs text-ink hover:text-brand-700"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: lead.convertedMatter.color }}
                    />
                    <span className="font-medium">
                      {lead.convertedMatter.name}
                    </span>
                    <span className="text-2xs text-ink-4">
                      · {lead.convertedMatter.area}
                    </span>
                    <span className="text-2xs text-ink-4">
                      · {lead.convertedMatter.stage}
                    </span>
                  </Link>
                </CardContent>
              </Card>
            )}
            {lead.stage === "declined" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Ban size={14} className="text-ink-3" />
                    Declined
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-xs text-ink">
                    {lead.declineReason ?? "No reason recorded."}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Right column (1/3) ────────────────────────────────── */}
          <div className="flex flex-col gap-5">
            {/* Contact */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Contact</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 flex flex-col gap-2">
                {lead.email && (
                  <div className="flex items-center gap-2 text-xs">
                    <Mail size={12} className="text-ink-4 shrink-0" />
                    <a
                      href={`mailto:${lead.email}`}
                      className="text-ink hover:text-brand-700 truncate"
                    >
                      {lead.email}
                    </a>
                  </div>
                )}
                {lead.phone && (
                  <div className="flex items-center gap-2 text-xs">
                    <Phone size={12} className="text-ink-4 shrink-0" />
                    <span className="text-ink font-mono">{lead.phone}</span>
                  </div>
                )}
                {!lead.email && !lead.phone && (
                  <div className="text-xs text-ink-4">
                    No contact info provided.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Intake meta */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Intake</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <dl className="flex flex-col gap-2.5 text-xs">
                  <MetaRow
                    label="Source"
                    value={
                      lead.source
                        ? `${LEAD_SOURCE_LABEL[lead.source] ?? lead.source}${lead.sourceDetail ? ` · ${lead.sourceDetail}` : ""}`
                        : null
                    }
                  />
                  <MetaRow
                    label="Statute window"
                    value={
                      lead.statuteWindow !== null
                        ? `${lead.statuteWindow} days`
                        : null
                    }
                    warn={
                      lead.statuteWindow !== null && lead.statuteWindow <= 30
                    }
                    mono
                  />
                  <MetaRow
                    label="Received"
                    value={formatDate(lead.createdAt)}
                  />
                </dl>
              </CardContent>
            </Card>

            {/* Conflict check */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  {lead.conflictCheck === "clear" ? (
                    <ShieldCheck size={14} className="text-ok" />
                  ) : lead.conflictCheck === "warn" ||
                    lead.conflictCheck === "conflict" ? (
                    <TriangleAlert size={14} className="text-warn" />
                  ) : (
                    <Hourglass size={14} className="text-ink-3" />
                  )}
                  Conflict check
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-xs text-ink">
                  {lead.conflictCheck === "clear" &&
                    "No conflicts found in the firm's existing matters."}
                  {lead.conflictCheck === "pending" &&
                    "Conflict check is still running — re-visit once complete."}
                  {lead.conflictCheck === "warn" &&
                    "Possible positional conflict flagged — review before taking on this lead."}
                  {lead.conflictCheck === "conflict" &&
                    "Direct conflict detected — representing this lead is not recommended."}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <dt className="text-ink-4 mb-0.5 flex items-center gap-1">
        {icon}
        {label}
      </dt>
      <dd className="text-ink">{value || "—"}</dd>
    </div>
  );
}

function MetaRow({
  label,
  value,
  warn,
  mono,
}: {
  label: string;
  value: string | null;
  warn?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-4">{label}</span>
      <span
        className={
          (warn ? "text-warn font-medium" : "text-ink") +
          (mono ? " font-mono" : "")
        }
      >
        {value ?? "—"}
      </span>
    </div>
  );
}
