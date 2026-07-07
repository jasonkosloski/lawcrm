/**
 * Lead Detail — Overview tab
 *
 * Default tab for a lead. Shows case summary, assessment, contact,
 * intake meta, and conflict-check cards. The TopBar + tab bar live in
 * the parent layout so this file is pure tab content.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Ban,
  Building2,
  CheckCircle2,
  Hourglass,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmailLink } from "@/components/ui/email-link";
import { ConflictCheckCard } from "@/components/intake/conflict-check-card";
// Centralized date formatting — default "medium" matches the
// "Apr 15, 2026" this page always used. dateOfIncident is date-only
// (server-local day grid, no TZ override); createdAt is a real
// instant, so it threads the viewer's TZ (ADR-012).
import { formatDate } from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { formatPhone } from "@/lib/format-phone";
import { getLeadById, LEAD_SOURCE_LABEL } from "@/lib/queries/leads";
import { runConflictMatcher } from "@/lib/conflict-check";
import { currentUserHasPermission } from "@/lib/permission-check";

const ASSESSMENT_LABEL: Record<string, string> = {
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak",
};

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

export default async function LeadOverviewPage({
  params,
}: PageProps<"/intake/[id]">) {
  const { id } = await params;
  const lead = await getLeadById(id);
  if (!lead) notFound();

  // Run the matcher live on every page load so a freshly added
  // contact / opposing party shows up without re-clicking "Run."
  // The matcher is read-only and bounded — see lib/conflict-check.ts.
  const [conflictResult, canRunCheck, canOverride, tz] = await Promise.all([
    runConflictMatcher({
      name: lead.contact?.name ?? lead.name ?? null,
      email: lead.contact?.email ?? lead.email ?? null,
      organization: lead.contact?.organization ?? null,
    }),
    currentUserHasPermission("intake.conflict_check.run"),
    currentUserHasPermission("intake.conflict_check.override"),
    // "Received" is a real instant — render it on the viewer's
    // calendar, not the server's (UTC in prod).
    getCurrentUserTimeZone(),
  ]);

  return (
    <div className="p-3 sm:p-5">
      {/* Two-pane on lg+, stacked below — case summary first, then
          the contact / status / conflict rail. */}
      <div className="max-w-4xl grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Main column ─────────────────────────────────────────── */}
        <div className="lg:col-span-2 flex flex-col gap-5">
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
              <AssessmentBar label="Damages" value={lead.damagesAssessment} />
              {lead.defendantAbility && (
                <div className="mt-2 pt-3 border-t border-line text-xs">
                  <div className="text-ink-4 mb-1">
                    Defendant&apos;s ability to pay
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
          {/* Contact — joined Contact wins; legacy text columns are
              the fallback for un-backfilled rows. When linked, the
              header doubles as a deep link to /contacts/[id] so the
              user can hop to the full contact record. */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span>Contact</span>
                {lead.contact && (
                  <Link
                    href={`/contacts/${lead.contact.id}`}
                    className="ml-auto inline-flex items-center gap-1 text-2xs font-mono text-ink-4 hover:text-brand-700"
                    title="Open full contact record"
                  >
                    <UserCheck size={11} />
                    Open
                  </Link>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-ink font-medium truncate">
                  {lead.displayName}
                </span>
              </div>
              {lead.contact?.organization && (
                <div className="flex items-center gap-2 text-xs">
                  <Building2 size={12} className="text-ink-4 shrink-0" />
                  <span className="text-ink-3 truncate">
                    {lead.contact.organization}
                  </span>
                </div>
              )}
              {lead.displayEmail && (
                <div className="flex items-center gap-2 text-xs">
                  <Mail size={12} className="text-ink-4 shrink-0" />
                  <EmailLink
                    email={lead.displayEmail}
                    className="text-ink truncate"
                  />
                </div>
              )}
              {/* Render all phones from the joined Contact when present
                  — same shape as the parties tab's phone display.
                  Falls back to lead.displayPhone (mirror) for un-
                  backfilled rows. */}
              {lead.contact && lead.contact.phones.length > 0 ? (
                lead.contact.phones.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 text-xs"
                  >
                    <Phone size={12} className="text-ink-4 shrink-0" />
                    {p.label && (
                      <span className="text-ink-4 mr-1">{p.label}</span>
                    )}
                    <span className="text-ink font-mono">
                      {formatPhone(p.number)}
                    </span>
                    {p.isPrimary && lead.contact!.phones.length > 1 && (
                      <span className="text-[9px] text-brand-700">
                        primary
                      </span>
                    )}
                  </div>
                ))
              ) : lead.displayPhone ? (
                <div className="flex items-center gap-2 text-xs">
                  <Phone size={12} className="text-ink-4 shrink-0" />
                  <span className="text-ink font-mono">
                    {formatPhone(lead.displayPhone)}
                  </span>
                </div>
              ) : null}
              {!lead.displayEmail && !lead.displayPhone && (
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
                  value={formatDate(lead.createdAt, "medium", tz)}
                />
              </dl>
            </CardContent>
          </Card>

          {/* Conflict check */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                Conflict check
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ConflictCheckCard
                leadId={lead.id}
                status={
                  lead.conflictCheck as
                    | "pending"
                    | "clear"
                    | "warn"
                    | "conflict"
                    | "override"
                }
                checkedAt={lead.conflictCheckedAt}
                resolutionNotes={lead.conflictResolutionNotes}
                matches={conflictResult.matches}
                canRun={canRunCheck}
                canOverride={canOverride}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
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
