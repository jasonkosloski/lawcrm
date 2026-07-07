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
import { cn } from "@/lib/utils";
import { Mail, Phone, Pin } from "lucide-react";
import { StageChanger } from "@/components/matters/stage-changer";
import { StatuteOfLimitationsCard } from "@/components/matters/statute-of-limitations-card";
import { EmailLink } from "@/components/ui/email-link";
import { formatPhone } from "@/lib/format-phone";
// Centralized date formatting — default "medium" matches the "Apr 15,
// 2026" this page always used. Filed/trial are date-only values
// (server-local midnight), so no TZ override.
import { formatDate } from "@/lib/format-date";
import { prisma } from "@/lib/prisma";
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

const formatMoney = (n: number): string => `$${n.toLocaleString("en-US")}`;

export default async function MatterOverviewPage({
  params,
}: PageProps<"/matters/[id]">) {
  const { id } = await params;
  const matter = await getMatterById(id);
  if (!matter) notFound();

  const [deadlines, tasks, notes, stageOptions, clientRows] =
    await Promise.all([
      getMatterDeadlines(id),
      getMatterTasks(id),
      getMatterNotes(id),
      prisma.matterStage.findMany({
        where: { practiceAreaId: matter.practiceAreaId, isActive: true },
        orderBy: { order: "asc" },
        select: { id: true, name: true, order: true, isTerminal: true },
      }),
      // All client-category parties on this matter (primary + any
      // co-clients). Ordered primary-first via contactId match below.
      prisma.matterContact.findMany({
        where: { matterId: id, category: "client" },
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              email: true,
              organization: true,
              phones: {
                orderBy: [{ isPrimary: "desc" }, { order: "asc" }],
                select: {
                  id: true,
                  label: true,
                  number: true,
                  isPrimary: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

  // Pin the primary client (Matter.clientId) to the top of the list.
  const clients = [...clientRows].sort(
    (a, b) =>
      (b.contact.id === matter.clientId ? 1 : 0) -
      (a.contact.id === matter.clientId ? 1 : 0)
  );

  const upcomingDeadlines = deadlines
    .filter((d) => d.status === "open")
    .slice(0, 4);
  const openTasks = tasks
    .filter((t) => t.status === "open" || t.status === "in_progress")
    .slice(0, 5);
  // Every pinned note shows on the overview — the lawyer expressly
  // chose them as the "always-visible reference items" for this
  // case. Older behavior fell back to the most-recent note when
  // nothing was pinned; that's been dropped because (a) the Notes
  // tab is one click away, (b) showing un-pinned content here
  // turned the overview into a stale-feed surface, and (c) the
  // empty state encourages the lawyer to pin the note that matters.
  const pinnedNotes = notes.filter((n) => n.isPinned);

  return (
    <div className="p-3 sm:p-5">
      {/* 3-column grid at lg+; single column below. The right rail
          (case facts + team) sits below the main content on
          smaller screens so the user reads top-to-bottom. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Main column ─────────────────────────────────────────── */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {/* Stage transition */}
          <Card>
            <CardContent className="px-4 py-4">
              <StageChanger
                matterId={matter.id}
                stages={stageOptions}
                currentStageId={matter.stageId}
              />
            </CardContent>
          </Card>

          {/* Statute of limitations — only for practice areas that
              track SOL. Placed above Case facts because when it
              matters, it's the most time-sensitive thing on the
              page. */}
          {matter.practiceAreaHasStatuteOfLimitations && (
            <StatuteOfLimitationsCard
              matterId={matter.id}
              date={matter.statuteOfLimitationsDate}
              satisfied={matter.statuteOfLimitationsSatisfied}
              satisfiedAt={matter.statuteOfLimitationsSatisfiedAt}
              notes={matter.statuteOfLimitationsNotes}
              citation={matter.practiceAreaStatuteSourceCitation}
              incidentDate={matter.incidentDate}
            />
          )}

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

          {/* Pinned notes — every pinned note for this matter,
              stacked. Content is sanitized server-side at write
              time (see notes.ts → DOMPurify), so dangerouslySetInnerHTML
              is safe and lets the rich-text composer's markup
              actually render instead of leaking <p>/<ul>/etc. as
              literal text. Plain-text seed notes pass through fine
              — bare text inside the div renders as bare text. */}
          {pinnedNotes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">
                    <div className="flex items-center gap-2">
                      <Pin
                        size={12}
                        className="fill-brand-500 text-brand-500"
                      />
                      Pinned{" "}
                      {pinnedNotes.length === 1 ? "note" : "notes"}
                      <span className="text-2xs font-mono font-normal text-ink-4 ml-0.5">
                        {pinnedNotes.length}
                      </span>
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
              <CardContent className="px-4 pb-4 flex flex-col gap-3">
                {pinnedNotes.map((note, idx) => (
                  <div
                    key={note.id}
                    className={cn(
                      "flex flex-col gap-1.5",
                      // Hairline separators between stacked notes;
                      // first one needs none.
                      idx > 0 && "pt-3 border-t border-line"
                    )}
                  >
                    <div className="flex items-center justify-between text-2xs">
                      <span className="text-ink-3">
                        {note.authorName}
                      </span>
                      <Link
                        href={`/matters/${matter.id}/notes#note-${note.id}`}
                        className="font-mono text-ink-4 hover:text-brand-700 hover:underline"
                      >
                        {formatDate(note.createdAt)} →
                      </Link>
                    </div>
                    <div
                      className={cn(
                        "prose prose-sm max-w-none text-xs text-ink leading-relaxed line-clamp-6",
                        // Match the composer's content styles so
                        // reading + writing look the same. Mirrors
                        // note-card.tsx so the overview preview
                        // and the full Notes tab feel identical.
                        "[&_p]:my-1 [&_p]:text-xs [&_p]:text-ink",
                        "[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-0.5",
                        "[&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-1 [&_h3]:mb-0.5",
                        "[&_ul]:my-1 [&_ol]:my-1 [&_li]:text-xs [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:list-disc [&_ol]:list-decimal",
                        "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-3 [&_blockquote]:italic",
                        "[&_code]:bg-paper-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_code]:font-mono"
                      )}
                      dangerouslySetInnerHTML={{ __html: note.content }}
                    />
                  </div>
                ))}
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
                            ? formatDate(t.dueDate, "short")
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
          {/* Clients — always visible thanks to the MatterContact
              invariant (see createMatter/updateMatter). */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  {clients.length === 1 ? "Client" : "Clients"}
                </CardTitle>
                <Link
                  href={`/matters/${matter.id}/parties`}
                  className="text-2xs text-brand-700 hover:underline"
                >
                  All parties →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {clients.length === 0 ? (
                <div className="py-2 text-xs text-ink-4">
                  No client on this matter yet — set one via{" "}
                  <Link
                    href={`/matters/${matter.id}/edit`}
                    className="text-brand-700 hover:underline"
                  >
                    Edit matter
                  </Link>
                  .
                </div>
              ) : (
                <ul className="flex flex-col gap-3">
                  {clients.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-col gap-1 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink truncate">
                          {row.contact.name}
                        </span>
                        {row.contact.id === matter.clientId && (
                          <span
                            className="text-2xs font-medium px-1.5 py-0.5 rounded-full bg-brand-soft text-brand-700 border border-brand-200"
                            title="Matter's primary client"
                          >
                            Primary
                          </span>
                        )}
                      </div>
                      {row.contact.organization && (
                        <div className="text-2xs text-ink-3">
                          {row.contact.organization}
                        </div>
                      )}
                      {row.contact.email && (
                        <div className="flex items-center gap-1.5 text-2xs">
                          <Mail size={11} className="text-ink-4 shrink-0" />
                          <EmailLink
                            email={row.contact.email}
                            className="text-ink truncate"
                          />
                        </div>
                      )}
                      {row.contact.phones.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {row.contact.phones.map((p) => (
                            <div
                              key={p.id}
                              className="flex items-center gap-1.5 text-2xs"
                            >
                              <Phone
                                size={11}
                                className="text-ink-4 shrink-0"
                              />
                              {p.label && (
                                <span className="text-ink-4">
                                  {p.label}
                                </span>
                              )}
                              <a
                                href={`tel:${p.number.replace(/\D/g, "")}`}
                                className="font-mono text-ink hover:text-brand-700 hover:underline"
                              >
                                {formatPhone(p.number)}
                              </a>
                              {p.isPrimary &&
                                row.contact.phones.length > 1 && (
                                  <span className="text-[9px] text-brand-700">
                                    primary
                                  </span>
                                )}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {row.notes && (
                        <div className="text-2xs text-ink-3 italic">
                          {row.notes}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

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
                  {matter.teamMembers.map((t) => {
                    const isFormer = t.removedAt !== null;
                    return (
                      <li
                        key={t.id}
                        className={cn(
                          "flex items-center gap-2.5",
                          // Former members stay visible (audit /
                          // historical attribution) but dim so the
                          // active roster reads as primary.
                          isFormer && "opacity-60"
                        )}
                      >
                        <span
                          className={cn(
                            "inline-flex items-center justify-center w-7 h-7 rounded-full text-2xs font-mono font-medium border shrink-0",
                            isFormer
                              ? "bg-paper-2 text-ink-4 border-line"
                              : "bg-brand-50 text-brand-700 border-brand-100"
                          )}
                        >
                          {t.user.initials}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              "text-xs font-medium truncate",
                              isFormer ? "text-ink-3" : "text-ink"
                            )}
                          >
                            {t.user.name}
                          </div>
                          <div className="text-2xs text-ink-4">
                            {ROLE_LABEL[t.role] ?? t.role}
                            {isFormer && (
                              <span className="italic"> (former)</span>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
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
