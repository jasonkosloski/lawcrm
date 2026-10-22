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
import { Mail, Phone } from "lucide-react";
import { StageChanger } from "@/components/matters/stage-changer";
import { StatuteOfLimitationsCard } from "@/components/matters/statute-of-limitations-card";
import { EmailLink } from "@/components/ui/email-link";
import { formatPhone } from "@/lib/format-phone";
// Filed / trial / task due dates are date-only (formatDateOnly never
// shifts the day); the pinned-note timestamp is an instant and renders
// in the viewer's profile zone (ADR-012).
import { dateOnlyKey, formatDateOnly } from "@/lib/format-date";
import { originatingDocLabel } from "@/lib/originating-doc";
import { AgreementCard } from "@/components/matters/agreement-card";
import { formatMoney } from "@/lib/format-money";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { prisma } from "@/lib/prisma";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getMatterById } from "@/lib/queries/matters";
import {
  getMatterDeadlines,
  getMatterNotes,
  getMatterTasks,
  getMatterTimeSummary,
} from "@/lib/queries/matter-detail";
import { requireUser } from "@/lib/current-user";
import { assertMatterAccess } from "@/lib/matter-access";
import { getNoteAccess } from "@/lib/note-access";
import { allowedCaptureKinds } from "@/lib/note-constants";
import { PortalCard } from "@/components/matters/portal-card";
import { getPortalCardData } from "@/lib/queries/portal-access";
import { ClientRequestsCard } from "@/components/matters/client-requests-card";
import { getDocumentRequestsForMatter } from "@/lib/queries/document-requests";
import { ClientStatusCard } from "@/components/matters/client-status-card";
import { getClientStatusCardData } from "@/lib/queries/portal-status";
import { NoteComposer } from "@/components/matters/notes/note-composer";
import { NotesTabBody } from "@/components/matters/notes/notes-tab-body";
import { Badge } from "@/components/ui/badge";

const ROLE_LABEL: Record<string, string> = {
  lead: "Lead attorney",
  co_counsel: "Co-counsel",
  paralegal: "Paralegal",
  investigator: "Investigator",
  of_counsel: "Of counsel",
};

/** "3d" / "today" / "2d late" for a whole-day distance from today. */
function dayDistanceLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d late`;
  if (days === 0) return "today";
  return `${days}d`;
}

export default async function MatterOverviewPage({
  params,
}: PageProps<"/matters/[id]">) {
  const userId = await requireUser();
  const { id } = await params;
  await assertMatterAccess(id);
  const tz = await getCurrentUserTimeZone();

  // Everything runs as one wave: the previews are narrow queries (only
  // the rows the cards render), and the stage list chains onto the
  // matter fetch instead of waiting for it before anything else starts.
  const [
    matter,
    deadlines,
    tasks,
    notes,
    noteAccess,
    timeSummary,
    clientRows,
    canEditMatter,
    canViewBilling,
    canViewPortal,
    canInvitePortal,
    canRevokePortal,
    canShareBilling,
    canAddRequests,
    canEditRequests,
    canDeleteRequests,
    canAddUpdates,
    canEditUpdates,
    canDeleteUpdates,
    canEditAgreement,
  ] = await Promise.all([
    getMatterById(id),
    getMatterDeadlines(id, { tz, openOnly: true, limit: 4 }),
    getMatterTasks(id, { tz, openOnly: true, limit: 5 }),
    // The full notes list, same as the Notes tab (pinned first), so
    // notes can be read and written from the matter's main page.
    getMatterNotes(id),
    getNoteAccess(),
    // Live WIP — the same unbilled-time figure the Billing tab shows.
    // (Matter.wipAmount is never written by any action.)
    getMatterTimeSummary(id),
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
    currentUserHasPermission("matters.edit"),
    currentUserHasPermission("billing.view"),
    currentUserHasPermission("portal.view"),
    currentUserHasPermission("portal.invite"),
    currentUserHasPermission("portal.revoke"),
    currentUserHasPermission("portal.share_billing"),
    currentUserHasPermission("portal.add_requests"),
    currentUserHasPermission("portal.edit_requests"),
    currentUserHasPermission("portal.delete_requests"),
    currentUserHasPermission("portal.add_updates"),
    currentUserHasPermission("portal.edit_updates"),
    currentUserHasPermission("portal.delete_updates"),
    currentUserHasPermission("matters.agreement.edit"),
  ]);
  if (!matter) notFound();

  // Picker documents and the firm switch matter only to the edit form.
  // The matter load above is the access check; documents are scoped to
  // that same, already-authorized matter.
  const [agreementDocuments, agreementRequired] = canEditAgreement
    ? await Promise.all([
        prisma.document.findMany({
          where: { matterId: matter.id, status: { not: "archived" } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.user
          .findUnique({
            where: { id: userId },
            select: { firm: { select: { requireOriginatingDoc: true } } },
          })
          .then((u) => u?.firm?.requireOriginatingDoc ?? false),
      ])
    : [[], false];

  // The loader needs portal.view (it returns nothing without it), so
  // it runs only for holders.
  const [portal, clientRequests, clientStatus] = canViewPortal
    ? await Promise.all([
        getPortalCardData(id),
        getDocumentRequestsForMatter(id),
        getClientStatusCardData(id),
      ])
    : [null, null, null];

  const stageOptions = await prisma.matterStage.findMany({
    // Active stages, plus the matter's own stage even if it was
    // archived after the matter landed there (the stepper must still
    // show where the matter sits; StageChanger won't offer an
    // archived stage as a move target).
    where: {
      practiceAreaId: matter.practiceAreaId,
      OR: [{ isActive: true }, { id: matter.stageId }],
    },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      order: true,
      isTerminal: true,
      isActive: true,
    },
  });

  // Pin the primary client (Matter.clientId) to the top of the list.
  const clients = [...clientRows].sort(
    (a, b) =>
      (b.contact.id === matter.clientId ? 1 : 0) -
      (a.contact.id === matter.clientId ? 1 : 0)
  );

  const upcomingDeadlines = deadlines;
  const openTasks = tasks;

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
                canEdit={canEditMatter}
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
              statutePeriod={matter.practiceAreaStatutePeriod}
              canEdit={canEditMatter}
            />
          )}

          <AgreementCard
            matterId={matter.id}
            label={originatingDocLabel({
              originatingDocLabel: matter.practiceAreaOriginatingDocLabel,
            })}
            agreement={
              matter.agreement
                ? {
                    status: matter.agreement.status,
                    signedDate: matter.agreement.signedDate
                      ? dateOnlyKey(matter.agreement.signedDate)
                      : null,
                    document: matter.agreement.document,
                  }
                : null
            }
            documents={agreementDocuments}
            canEdit={canEditAgreement}
            required={agreementRequired}
          />

          {/* Case facts */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Case facts</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-xs">
                <Fact label="Court" value={matter.court} />
                <Fact label="Case number" value={matter.caseNumber} mono />
                <Fact label="Filed" value={formatDateOnly(matter.filedDate)} />
                <Fact label="Trial" value={formatDateOnly(matter.trialDate)} />
                <Fact label="Opposing party" value={matter.opposingParty} />
                <Fact label="Opposing firm" value={matter.opposingFirm} />
                {canViewBilling && (
                  <>
                    <Fact
                      label="Trust balance"
                      value={formatMoney(matter.trustBalance)}
                      mono
                    />
                    <Fact
                      label="WIP"
                      value={formatMoney(timeSummary.unbilledAmount)}
                      mono
                    />
                  </>
                )}
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

          {/* Notes — the same composer + list as the Notes tab (search,
              type filter, pinned-only, threads, replies, reactions),
              pinned notes first. Controls are gated by the viewer's
              note access, resolved on the server. */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  Notes
                  <span className="text-2xs font-mono font-normal text-ink-4 ml-1.5">
                    {notes.length}
                  </span>
                </CardTitle>
                <Link
                  href={`/matters/${matter.id}/notes`}
                  className="text-2xs text-brand-700 hover:underline"
                >
                  Notes tab →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 flex flex-col gap-4">
              {noteAccess.canCreateNote && (
                <NoteComposer
                  scope={{ kind: "matter", matterId: matter.id }}
                  canPin={noteAccess.canPin}
                  allowedKinds={allowedCaptureKinds(noteAccess, [
                    "task",
                    "event",
                    "deadline",
                    "time",
                  ])}
                />
              )}
              <NotesTabBody notes={notes} scope={{ kind: "matter", matterId: matter.id }} access={noteAccess} />
            </CardContent>
          </Card>

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
                          ? dayDistanceLabel(t.daysUntilDue)
                          : t.dueDate
                            ? formatDateOnly(t.dueDate, "short")
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
                          <Badge
                            title="Matter's primary client"
                          >
                            Primary
                          </Badge>
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
                                  <span className="text-3xs text-brand-700">
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

          {portal && (
            <PortalCard
              matterId={matter.id}
              rows={portal.rows}
              contacts={portal.contacts}
              canInvite={canInvitePortal}
              canRevoke={canRevokePortal}
              portalEnabled={portal.portalEnabled}
              portalBillingEnabled={portal.portalBillingEnabled}
              billedPortalContacts={portal.billedPortalContacts}
              canShareBilling={canShareBilling}
              tz={tz}
            />
          )}

          {clientStatus && (
            <ClientStatusCard
              matterId={matter.id}
              data={clientStatus}
              canAdd={canAddUpdates}
              canEdit={canEditUpdates}
              canDelete={canDeleteUpdates}
              tz={tz}
            />
          )}

          {clientRequests && (
            <ClientRequestsCard
              matterId={matter.id}
              requests={clientRequests.requests}
              hasLiveAccess={clientRequests.hasLiveAccess}
              canAdd={canAddRequests}
              canEdit={canEditRequests}
              canDelete={canDeleteRequests}
            />
          )}

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
                        {dayDistanceLabel(d.daysUntil)}
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
