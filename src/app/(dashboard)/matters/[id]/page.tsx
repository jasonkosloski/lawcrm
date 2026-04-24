/**
 * Matter Detail — Overview Tab
 *
 * Framework version: shows case facts, team roster, and a placeholder
 * for the content sections (deadlines preview, timeline preview,
 * strategy note) that come as individual features.
 */

import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMatterById } from "@/lib/queries/matters";

const ROLE_LABEL: Record<string, string> = {
  lead: "Lead attorney",
  co_counsel: "Co-counsel",
  paralegal: "Paralegal",
  investigator: "Investigator",
  of_counsel: "Of counsel",
};

const formatDate = (d: Date | null): string => {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatMoney = (n: number): string => `$${n.toLocaleString("en-US")}`;

export default async function MatterOverviewPage({
  params,
}: PageProps<"/matters/[id]">) {
  const { id } = await params;
  const matter = await getMatterById(id);
  if (!matter) notFound();

  return (
    <div className="p-5">
      <div className="grid grid-cols-3 gap-5">
        {/* ── Case facts ──────────────────────────────────────────── */}
        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Case facts</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-xs">
              <div>
                <dt className="text-ink-4 mb-0.5">Court</dt>
                <dd className="text-ink">{matter.court ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-4 mb-0.5">Case number</dt>
                <dd className="text-ink font-mono">
                  {matter.caseNumber ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-4 mb-0.5">Filed</dt>
                <dd className="text-ink">{formatDate(matter.filedDate)}</dd>
              </div>
              <div>
                <dt className="text-ink-4 mb-0.5">Trial</dt>
                <dd className="text-ink">{formatDate(matter.trialDate)}</dd>
              </div>
              <div>
                <dt className="text-ink-4 mb-0.5">Opposing party</dt>
                <dd className="text-ink">{matter.opposingParty ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-4 mb-0.5">Opposing firm</dt>
                <dd className="text-ink">{matter.opposingFirm ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-4 mb-0.5">Trust balance</dt>
                <dd className="font-mono text-ink">
                  {formatMoney(matter.trustBalance)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-4 mb-0.5">WIP</dt>
                <dd className="font-mono text-ink">
                  {formatMoney(matter.wipAmount)}
                </dd>
              </div>
              {matter.description && (
                <div className="col-span-2 pt-2 border-t border-line">
                  <dt className="text-ink-4 mb-1">Summary</dt>
                  <dd className="text-ink leading-relaxed">
                    {matter.description}
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* ── Team ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Team</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {matter.teamMembers.length === 0 ? (
              <div className="text-xs text-ink-4 py-2">
                No team assigned yet.
              </div>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {matter.teamMembers.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100 shrink-0">
                      {t.user.initials}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-ink truncate">
                        {t.user.name}
                      </div>
                      <div className="text-2xs text-ink-4">
                        {ROLE_LABEL[t.role] ?? t.role}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
