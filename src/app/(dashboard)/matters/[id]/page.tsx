/**
 * Matter Detail — Overview Tab
 *
 * The at-a-glance summary. Two-column layout:
 *  - Left: Case facts + (if present) strategy note preview + next
 *          upcoming deadlines + open tasks preview
 *  - Right: Team roster
 *
 * Each preview card links to its dedicated tab for the full list.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pin } from "lucide-react";
import { getMatterById } from "@/lib/queries/matters";
import {
  getMatterDeadlines,
  getMatterNotes,
  getMatterTasks,
} from "@/lib/queries/matter-detail";

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

  const [deadlines, tasks, notes] = await Promise.all([
    getMatterDeadlines(id),
    getMatterTasks(id),
    getMatterNotes(id),
  ]);

  const upcomingDeadlines = deadlines
    .filter((d) => d.status === "open")
    .slice(0, 4);
  const openTasks = tasks
    .filter((t) => t.status === "open" || t.status === "in_progress")
    .slice(0, 5);
  const pinnedNote = notes.find((n) => n.isPinned) ?? notes[0] ?? null;

  return (
    <div className="p-5">
      <div className="grid grid-cols-3 gap-5">
        {/* ── Left column ─────────────────────────────────────────── */}
        <div className="col-span-2 flex flex-col gap-5">
          {/* Case facts */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Case facts</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-xs">
                <Fact label="Court" value={matter.court} />
                <Fact label="Case number" value={matter.caseNumber} mono />
                <Fact label="Filed" value={formatDate(matter.filedDate)} />
                <Fact label="Trial" value={formatDate(matter.trialDate)} />
                <Fact label="Opposing party" value={matter.opposingParty} />
                <Fact label="Opposing firm" value={matter.opposingFirm} />
                <Fact
                  label="Trust balance"
                  value={formatMoney(matter.trustBalance)}
                  mono
                />
                <Fact
                  label="WIP"
                  value={formatMoney(matter.wipAmount)}
                  mono
                />
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

          {/* Strategy note preview */}
          {pinnedNote && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">
                    <div className="flex items-center gap-2">
                      {pinnedNote.isPinned && (
                        <Pin
                          size={12}
                          className="fill-brand-500 text-brand-500"
                        />
                      )}
                      Note · {pinnedNote.authorName}
                    </div>
                  </CardTitle>
                  <Link
                    href={`/matters/${matter.id}/notes`}
                    className="text-2xs text-brand-700 hover:underline"
                  >
                    All notes →
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-xs text-ink leading-relaxed whitespace-pre-wrap line-clamp-6">
                  {pinnedNote.content}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Open tasks preview */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  Open tasks
                </CardTitle>
                <Link
                  href={`/matters/${matter.id}/tasks`}
                  className="text-2xs text-brand-700 hover:underline"
                >
                  All tasks →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {openTasks.length === 0 ? (
                <div className="py-2 text-xs text-ink-4">
                  No open tasks on this matter.
                </div>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {openTasks.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center gap-2 py-2 first:pt-0 last:pb-0"
                    >
                      <span
                        className={
                          "w-3.5 h-3.5 rounded-full border shrink-0 " +
                          (t.status === "in_progress"
                            ? "border-brand-500 bg-brand-50"
                            : "border-line")
                        }
                      />
                      <span className="flex-1 text-xs text-ink truncate">
                        {t.title}
                      </span>
                      <span className="text-2xs font-mono text-ink-4 w-14 text-right shrink-0">
                        {t.daysUntilDue !== null && t.daysUntilDue <= 7
                          ? t.daysUntilDue < 0
                            ? `${Math.abs(t.daysUntilDue)}d late`
                            : `${t.daysUntilDue}d`
                          : t.dueDate
                            ? t.dueDate.toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })
                            : "—"}
                      </span>
                      {t.ownerInitials && (
                        <span
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100 shrink-0"
                          title={t.ownerName ?? undefined}
                        >
                          {t.ownerInitials}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right column ────────────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          {/* Upcoming deadlines */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  Upcoming deadlines
                </CardTitle>
                <Link
                  href={`/matters/${matter.id}/deadlines`}
                  className="text-2xs text-brand-700 hover:underline"
                >
                  All →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {upcomingDeadlines.length === 0 ? (
                <div className="py-2 text-xs text-ink-4">
                  No open deadlines.
                </div>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {upcomingDeadlines.map((d) => (
                    <li key={d.id} className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-ink truncate">
                          {d.title}
                        </div>
                        {d.sourceRef && (
                          <div className="text-2xs font-mono text-ink-4 truncate">
                            {d.sourceRef}
                          </div>
                        )}
                      </div>
                      <span
                        className={
                          "text-2xs font-mono font-medium px-2 py-0.5 rounded-full border shrink-0 " +
                          (d.kind === "critical"
                            ? "bg-warn-soft text-warn border-warn-border"
                            : d.kind === "auto_rule"
                              ? "bg-brand-soft text-brand-700 border-brand-200"
                              : "bg-paper-2 text-ink-3 border-line")
                        }
                      >
                        {d.isOverdue
                          ? `${Math.abs(d.daysUntil)}d late`
                          : `${d.daysUntil}d`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Team */}
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
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-ink-4 mb-0.5">{label}</dt>
      <dd className={mono ? "font-mono text-ink" : "text-ink"}>
        {value || "—"}
      </dd>
    </div>
  );
}
