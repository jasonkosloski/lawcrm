/**
 * /settings/firm — Firm profile.
 *
 * Page reads the firm via the current user's session. Admins see the
 * editable form; non-admins see the read-only view (so everyone in
 * the firm can answer "what's our EIN" without needing admin perms).
 *
 * Future bits that'll land here as their features go live:
 *   - Logo upload (needs file storage)
 *   - Default fee structure / matter numbering scheme (Phase 6 Billing)
 *   - IOLTA / trust account info (Phase 6 Billing)
 *   - Per-office addresses (when firms outgrow a single location)
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FirmEditForm } from "@/components/settings/firm-edit-form";
import { FirmReadView } from "@/components/settings/firm-read-view";
import { FirmCalendarDefaultsCard } from "@/components/settings/calendar-defaults-card";
import { PortalEnabledCard } from "@/components/settings/portal-enabled-card";
import { MatterVisibilityCard } from "@/components/settings/matter-visibility-card";
import {
  ADMIN_ROLE_NAME,
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
      },
    }),
    getFirmGoals(),
  ]);
  // Admin-only: the wall switch + the rosters to fix before flipping it.
  const thin = isAdmin ? await listThinTeams() : null;
  const calendarDefaults = {
    autoAddTeamToNewEvents: firmSettings.autoAddTeamToNewEvents,
    autoAddTeamToUpcomingEvents: firmSettings.autoAddTeamToUpcomingEvents,
  };

  // Fetch the team count + admin list for the side panel — fast,
  // single query each. Admin invariant ("at least one admin") is
  // enforced wherever we'd let the user demote one (deferred until
  // /settings/team lands).
  const [memberCount, admins] = await Promise.all([
    prisma.user.count({ where: { firmId: firm.id, isActive: true } }),
    // Admins = active users holding the firm's "Admin" role. Pull
    // by role-name match so this stays correct if/when we add
    // multiple admin-tier roles in the future.
    prisma.user.findMany({
      where: {
        firmId: firm.id,
        isActive: true,
        userRoles: { some: { role: { name: ADMIN_ROLE_NAME } } },
      },
      select: { id: true, name: true, email: true, initials: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-6 max-w-5xl">
      <div className="min-w-0">
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
      </div>

      {/* Right rail — quick context about firm members + admins. */}
      <aside className="flex flex-col gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Team</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xs text-ink-3">
              <span className="text-ink font-medium">{memberCount}</span>{" "}
              {memberCount === 1 ? "active member" : "active members"}.
            </div>
            <div className="text-2xs text-ink-4 mt-2">
              Manage roster, invites, and roles on the Team page.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              Admins
              <span className="text-2xs font-mono font-normal text-ink-4">
                {admins.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 flex flex-col gap-2">
            {admins.length === 0 ? (
              <div className="text-2xs text-warn">
                No admins on this firm — invariant violated. Re-seed or
                promote a user via the database.
              </div>
            ) : (
              admins.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100 shrink-0">
                    {a.initials}
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-ink truncate">{a.name}</span>
                    <span className="text-2xs text-ink-4 truncate">
                      {a.email}
                    </span>
                  </div>
                </div>
              ))
            )}
            <div className="text-[10px] text-ink-4 leading-relaxed pt-1 border-t border-line">
              Every firm needs at least one admin. The Team page
              prevents demoting the last one.
            </div>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
