/**
 * Edit Matter page
 *
 * Reached via the "Edit" button in the matter detail TopBar. Fetches
 * the current matter + form-option lists server-side, renders the
 * EditMatterForm which submits to the `updateMatter` server action.
 *
 * Inherits the parent matter-detail layout (TopBar + metadata strip +
 * tab bar), so the edit surface feels like a proper tab-scoped view
 * rather than a disconnected page. The Cancel + Save buttons route
 * back to the matter detail.
 *
 * The form itself is gated on `matters.edit` — same key `updateMatter`
 * enforces server-side. Without it the page swaps in a read-only
 * notice rather than a form whose submit can only fail.
 */

import { notFound } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { Card, CardContent } from "@/components/ui/card";
import { EditMatterForm, type MatterForEdit } from "@/components/matters/edit-matter-form";
import {
  MatterTeamManagement,
  type TeamMemberRow,
} from "@/components/matters/matter-team-management";
import { MatterCalendarDefaultsCard } from "@/components/settings/calendar-defaults-card";
import { toSolPeriod } from "@/lib/sol";
import { billingTypeOf } from "@/lib/billing-type";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { listVenues } from "@/lib/queries/venues";
import { getCurrentFirm } from "@/lib/firm";
import { assertMatterAccess } from "@/lib/matter-access";
import { MatterRestrictCard } from "@/components/matters/matter-restrict-card";

export default async function EditMatterPage({ params }: PageProps<"/matters/[id]/edit">) {
  // Pages guard themselves: layouts don't re-run on soft navigation (ADR-028).
  await requireUser();
  const { id } = await params;
  await assertMatterAccess(id);

  // The matter loads first: the client / lead option lists must always
  // include the matter's CURRENT client and lead, even when that contact
  // was deactivated / re-typed or that user left the firm. Otherwise the
  // selects have no matching option, the browser shows the first one, and
  // an unrelated save silently detaches the client or reassigns the lead.
  const matter = await prisma.matter.findUnique({
    where: { id },
    include: {
      // Pull every team membership (active + former) so the
      // edit page can render both buckets. The dedicated
      // team-management section uses this; the lead-finder
      // below scopes to active rows.
      teamMembers: {
        orderBy: [{ removedAt: "asc" }, { createdAt: "asc" }],
        include: {
          user: {
            select: { id: true, name: true, jobTitle: true, initials: true },
          },
        },
      },
    },
  });
  if (!matter) notFound();

  const activeLead = matter.teamMembers.find((m) => m.role === "lead" && !m.removedAt);

  const [
    areaRows,
    clientRows,
    userRows,
    canManageTeam,
    canEditMatter,
    canEditBillingType,
    firmDefaults,
    canRestrict,
    venueRows,
    currentVenue,
    canAddVenue,
    firm,
  ] = await Promise.all([
    prisma.practiceArea.findMany({
      where: { isActive: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        hasStatuteOfLimitations: true,
        statutePeriodAmount: true,
        statutePeriodUnit: true,
        statuteSourceCitation: true,
        requiredMatterFields: true,
        stages: {
          where: { isActive: true },
          orderBy: { order: "asc" },
          select: { id: true, name: true, order: true, isTerminal: true },
        },
      },
    }),
    prisma.contact.findMany({
      where: {
        OR: [
          { type: "client", isActive: true },
          ...(matter.clientId ? [{ id: matter.clientId }] : []),
        ],
      },
      select: { id: true, name: true, organization: true, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: {
        OR: [{ isActive: true }, ...(activeLead ? [{ id: activeLead.userId }] : [])],
      },
      select: {
        id: true,
        name: true,
        jobTitle: true,
        isActive: true,
        barAdmissions: { select: { id: true }, take: 1 },
      },
      orderBy: { name: "asc" },
    }),
    currentUserHasPermission("matters.manage_team"),
    currentUserHasPermission("matters.edit"),
    currentUserHasPermission("matters.billing_type.edit"),
    // Firm-wide defaults — surfaced as the inherit hint copy on
    // the matter override card. Single firm row in single-tenant
    // mode; the resolver scopes by firm when multi-tenant lands.
    prisma.firm.findFirstOrThrow({
      select: {
        autoAddTeamToNewEvents: true,
        autoAddTeamToUpcomingEvents: true,
      },
    }),
    currentUserHasPermission("matters.restrict"),
    listVenues({ activeOnly: true }),
    // The matter's current venue, kept in the picker even when archived.
    matter.venueId
      ? prisma.venue.findUnique({
          where: { id: matter.venueId },
          select: {
            id: true,
            name: true,
            city: true,
            county: true,
            state: true,
            isActive: true,
          },
        })
      : Promise.resolve(null),
    currentUserHasPermission("venues.add"),
    getCurrentFirm(),
  ]);

  const venues = venueRows.map((v) => ({
    id: v.id,
    name: v.name,
    city: v.city,
    county: v.county,
    state: v.state,
    isActive: v.isActive,
  }));
  if (currentVenue && !venues.some((v) => v.id === currentVenue.id)) {
    venues.push(currentVenue);
  }

  // Calendar period (ADR-035) as one serializable value for the forms.
  const areas = areaRows.map(({ statutePeriodAmount, statutePeriodUnit, ...a }) => ({
    ...a,
    statutePeriod: toSolPeriod(statutePeriodAmount, statutePeriodUnit),
  }));

  const clients = clientRows.map((c) => ({
    id: c.id,
    name: c.name,
    organization: c.organization,
    inactive: !c.isActive,
  }));
  // Lead picker: active users plus the (possibly deactivated) current
  // lead. The team-management card below only ever gets active users.
  // Only attorneys can be picked as lead, but the current lead stays
  // listed (grandfathered, or since deactivated) so "unchanged" is
  // selectable.
  const isAttorneyRow = (u: (typeof userRows)[number]) => u.isActive && u.barAdmissions.length > 0;
  const leadOptions = userRows
    .filter((u) => isAttorneyRow(u) || u.id === activeLead?.userId)
    .map((u) => ({
      id: u.id,
      name: u.name,
      jobTitle: u.jobTitle,
      inactive: !u.isActive,
    }));
  const attorneyIds = userRows.filter(isAttorneyRow).map((u) => u.id);
  const users = userRows
    .filter((u) => u.isActive)
    .map((u) => ({ id: u.id, name: u.name, jobTitle: u.jobTitle }));

  const forEdit: MatterForEdit = {
    id: matter.id,
    name: matter.name,
    caseNumber: matter.caseNumber,
    practiceAreaId: matter.practiceAreaId,
    stageId: matter.stageId,
    billingType: billingTypeOf(matter),
    court: matter.court,
    clientId: matter.clientId,
    opposingParty: matter.opposingParty,
    opposingFirm: matter.opposingFirm,
    description: matter.description,
    leadUserId: activeLead?.userId ?? null,
    incidentDate: matter.incidentDate,
    venueId: matter.venueId,
    filedDate: matter.filedDate,
    trialDate: matter.trialDate,
    statuteOfLimitationsDate: matter.statuteOfLimitationsDate,
    statuteOfLimitationsNotes: matter.statuteOfLimitationsNotes,
  };

  // Shape for the team-management card. Includes former members
  // so the audit trail surfaces during edit; the component
  // separates active vs. former internally.
  const teamMembers: TeamMemberRow[] = matter.teamMembers.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name,
    jobTitle: m.user.jobTitle,
    initials: m.user.initials,
    role: m.role,
    removedAt: m.removedAt,
  }));

  return (
    <div className="p-5">
      <div className="max-w-3xl flex flex-col gap-5">
        {/* Main edit form — gated on `matters.edit`, the same key the
            `updateMatter` action requires. Rendering the form to a
            user who can't submit it would only produce a server-side
            error on save, so swap in a read-only notice instead
            (mirrors the canManageTeam gate on the team card below). */}
        {canEditMatter ? (
          <Card>
            <CardContent className="p-5">
              <EditMatterForm
                matter={forEdit}
                options={{
                  areas,
                  clients,
                  users: leadOptions,
                  venues,
                  canAddVenue,
                  firmState: firm.state ?? "",
                }}
                canChangeLead={canManageTeam}
                canEditBillingType={canEditBillingType}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-5 text-xs text-ink-3">
              Matter details are read-only for your role. Editing is gated on the{" "}
              <span className="text-ink font-medium">matters.edit</span> permission, assigned via
              /settings/roles.
            </CardContent>
          </Card>
        )}

        {/* Team management — gated on `matters.manage_team`. Admin
            always has it; other roles get it via the matrix on
            /settings/roles. */}
        {canManageTeam && (
          <Card>
            <CardContent className="p-5">
              <MatterTeamManagement
                matterId={matter.id}
                members={teamMembers}
                userOptions={users}
                attorneyIds={attorneyIds}
              />
            </CardContent>
          </Card>
        )}

        {/* Restrict to the case team (ADR-049) — `matters.restrict`. */}
        {canRestrict && (
          <Card>
            <CardContent className="p-5">
              <MatterRestrictCard matterId={matter.id} restricted={matter.restricted} />
            </CardContent>
          </Card>
        )}

        {/* Per-matter calendar defaults — gated on `matters.edit`
            for write; everyone can read the toggle state. */}
        <MatterCalendarDefaultsCard
          matterId={matter.id}
          current={{
            autoAddTeamToNewEvents: matter.autoAddTeamToNewEvents,
            autoAddTeamToUpcomingEvents: matter.autoAddTeamToUpcomingEvents,
          }}
          firmDefaults={firmDefaults}
          canEdit={canEditMatter}
        />

        <div className="text-2xs text-ink-4">
          {canManageTeam
            ? "Archiving and deletion are separate actions — see the Matter Actions menu (coming)."
            : "Team changes, archiving, and deletion are gated on per-feature permissions assigned via /settings/roles."}
        </div>
      </div>
    </div>
  );
}
