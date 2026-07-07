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
import { Card, CardContent } from "@/components/ui/card";
import {
  EditMatterForm,
  type MatterForEdit,
} from "@/components/matters/edit-matter-form";
import {
  MatterTeamManagement,
  type TeamMemberRow,
} from "@/components/matters/matter-team-management";
import { MatterCalendarDefaultsCard } from "@/components/settings/calendar-defaults-card";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";

export default async function EditMatterPage({
  params,
}: PageProps<"/matters/[id]/edit">) {
  const { id } = await params;

  const [
    matter,
    areas,
    clients,
    users,
    canManageTeam,
    canEditMatter,
    firmDefaults,
  ] = await Promise.all([
    prisma.matter.findUnique({
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
    }),
    prisma.practiceArea.findMany({
      where: { isActive: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        hasStatuteOfLimitations: true,
        statutePeriodDays: true,
        statuteSourceCitation: true,
        stages: {
          where: { isActive: true },
          orderBy: { order: "asc" },
          select: { id: true, name: true, order: true, isTerminal: true },
        },
      },
    }),
    prisma.contact.findMany({
      where: { type: "client", isActive: true },
      select: { id: true, name: true, organization: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, jobTitle: true },
      orderBy: { name: "asc" },
    }),
    currentUserHasPermission("matters.manage_team"),
    currentUserHasPermission("matters.edit"),
    // Firm-wide defaults — surfaced as the inherit hint copy on
    // the matter override card. Single firm row in single-tenant
    // mode; the resolver scopes by firm when multi-tenant lands.
    prisma.firm.findFirstOrThrow({
      select: {
        autoAddTeamToNewEvents: true,
        autoAddTeamToUpcomingEvents: true,
      },
    }),
  ]);

  if (!matter) notFound();

  const activeLead = matter.teamMembers.find(
    (m) => m.role === "lead" && !m.removedAt
  );

  const forEdit: MatterForEdit = {
    id: matter.id,
    name: matter.name,
    caseNumber: matter.caseNumber,
    practiceAreaId: matter.practiceAreaId,
    stageId: matter.stageId,
    feeStructure: matter.feeStructure,
    billingMode: matter.billingMode,
    court: matter.court,
    clientId: matter.clientId,
    opposingParty: matter.opposingParty,
    opposingFirm: matter.opposingFirm,
    description: matter.description,
    leadUserId: activeLead?.userId ?? null,
    incidentDate: matter.incidentDate,
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
                options={{ areas, clients, users }}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-5 text-xs text-ink-3">
              Matter details are read-only for your role. Editing is
              gated on the{" "}
              <span className="text-ink font-medium">matters.edit</span>{" "}
              permission, assigned via /settings/roles.
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
              />
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
