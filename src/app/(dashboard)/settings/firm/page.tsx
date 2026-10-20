/**
 * /settings/firm — Firm profile.
 *
 * Page reads the firm via the current user's session. Admins see the
 * editable form; non-admins see the read-only view (so everyone in
 * the firm can answer "what's our EIN" without needing admin perms).
 */

import { FirmEditForm } from "@/components/settings/firm-edit-form";
import { FirmReadView } from "@/components/settings/firm-read-view";
import { FirmCalendarDefaultsCard } from "@/components/settings/calendar-defaults-card";
import { PortalEnabledCard } from "@/components/settings/portal-enabled-card";
import { MatterVisibilityCard } from "@/components/settings/matter-visibility-card";
import { OriginatingDocCard } from "@/components/settings/originating-doc-card";
import {
  getCurrentFirm,
  getFirmGoals,
  isCurrentUserAdmin,
} from "@/lib/firm";
import { listThinTeams } from "@/lib/queries/thin-teams";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/current-user";

export default async function FirmSettingsPage() {
  await requireUser();
  const [firm, canEdit, isAdmin] = await Promise.all([
    getCurrentFirm(),
    currentUserHasPermission("firm.edit_info"),
    isCurrentUserAdmin(),
  ]);

  // Calendar default toggles aren't on the FirmProfile shape; the
  // goal targets come from the request-cached getFirmGoals.
  const [firmSettings, goals] = await Promise.all([
    prisma.firm.findUniqueOrThrow({
      where: { id: firm.id },
      select: {
        autoAddTeamToNewEvents: true,
        autoAddTeamToUpcomingEvents: true,
        matterVisibility: true,
        portalEnabled: true,
        requireOriginatingDoc: true,
      },
    }),
    getFirmGoals(),
  ]);
  // Admin-only: the wall switch + the rosters to fix before flipping it.
  const thin = isAdmin ? await listThinTeams() : null;
  // Admin-only: open matters (not archived, stage not terminal) with no
  // signed agreement on file, so the switch shows what it would catch.
  const missingCount = isAdmin
    ? await prisma.matter.count({
        where: {
          isArchived: false,
          stage: { isTerminal: false },
          OR: [{ agreement: { is: null } }, { agreement: { status: { not: "signed" } } }],
        },
      })
    : 0;
  const calendarDefaults = {
    autoAddTeamToNewEvents: firmSettings.autoAddTeamToNewEvents,
    autoAddTeamToUpcomingEvents: firmSettings.autoAddTeamToUpcomingEvents,
  };

  return (
    <div className="max-w-3xl">
      <div>
        <div className="mb-4">
          <h1 className="text-base font-semibold text-ink">Firm info</h1>
          <p className="text-xs text-ink-3 mt-1">
            Identity, contact, and address for {firm.shortName ?? firm.name}.
            Surfaces on letterhead, invoices, and matter documents.
          </p>
        </div>
        {canEdit ? (
          <FirmEditForm firm={firm} goals={goals} />
        ) : (
          <FirmReadView firm={firm} goals={goals} />
        )}

        <div className="mt-6">
          <FirmCalendarDefaultsCard
            current={calendarDefaults}
            canEdit={canEdit}
          />
        </div>

        {canEdit && (
          <div className="mt-6">
            <PortalEnabledCard current={firmSettings.portalEnabled} />
          </div>
        )}

        {isAdmin && thin && (
          <div className="mt-6">
            <MatterVisibilityCard
              current={firmSettings.matterVisibility}
              thinTotal={thin.total}
              thinRows={thin.rows}
            />
          </div>
        )}

        {isAdmin && (
          <div className="mt-6">
            <OriginatingDocCard
              current={firmSettings.requireOriginatingDoc}
              missingCount={missingCount}
            />
          </div>
        )}
      </div>
    </div>
  );
}
