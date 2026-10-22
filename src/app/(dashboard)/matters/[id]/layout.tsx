/**
 * Matter Detail Layout
 *
 * Header + tab bar + optional Create dock around every matter detail
 * tab. Fetches the matter once here so each tab doesn't re-fetch the
 * header data, and wraps everything in `CreateStackProvider` so
 * a stack of Create panels can coexist and persist across tab
 * navigation within the matter.
 *
 * Layout:
 *   TopBar           — matter name/stage/area/pin/Create dropdown
 *   Metadata strip   — compact one-line row of case facts
 *   Tab bar          — Overview, Timeline, Documents, …
 *   <flex row>
 *     Tab content    — the current tab's page
 *     Create dock    — focused Create panel (or modal) + chip stack
 *   </flex row>
 *
 * Next.js 16: dynamic route `params` is a Promise that must be awaited.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { MatterTabs } from "@/components/matters/matter-tabs";
import { PinToggle } from "@/components/matters/pin-toggle";
import { EmailMuteToggle } from "@/components/matters/email-mute-toggle";
import { MatterCreateMenu } from "@/components/matters/matter-create-menu";
import { CreateDock } from "@/components/create-stack/create-dock";
import { CreateStackProvider } from "@/components/create-stack/create-stack-provider";
import { getMatterById } from "@/lib/queries/matters";
import { currentUserHasPermission } from "@/lib/permission-check";
import { MATTER_CREATE_ENTRIES, MATTER_CREATE_PERMISSION } from "@/lib/matter-create-types";
import { requireUser } from "@/lib/current-user";
import { BILLING_TYPE_LABEL, billingTypeOf } from "@/lib/billing-type";
import { isMatterEmailMuted } from "@/lib/queries/notification-preferences";
import { assertMatterAccess } from "@/lib/matter-access";
import { RestrictedBadge } from "@/components/shared/restricted-badge";

export default async function MatterDetailLayout({
  children,
  params,
}: LayoutProps<"/matters/[id]">) {
  const userId = await requireUser();
  const { id } = await params;
  await assertMatterAccess(id);
  const [
    matter,
    canEditMatter,
    canManageTeam,
    canViewBilling,
    canViewRecords,
    createFlags,
    emailMuted,
  ] = await Promise.all([
    getMatterById(id),
    currentUserHasPermission("matters.edit"),
    currentUserHasPermission("matters.manage_team"),
    currentUserHasPermission("billing.view"),
    currentUserHasPermission("records.view"),
    // Per-entity create keys for the "+ Create" menu (cached per
    // request, so this is a handful of Set lookups).
    Promise.all(
      MATTER_CREATE_ENTRIES.map(async (e) => ({
        type: e.type,
        allowed: await currentUserHasPermission(MATTER_CREATE_PERMISSION[e.type]),
      })),
    ),
    isMatterEmailMuted(userId, id),
  ]);
  if (!matter) notFound();
  const allowedCreateTypes = createFlags.filter((f) => f.allowed).map((f) => f.type);

  // Active lead only — a former lead shouldn't drive the metadata
  // strip (it'd display a wrong attribution and confuse reads).
  const leadMember = matter.teamMembers.find((t) => t.role === "lead" && t.removedAt === null);

  return (
    <CreateStackProvider
      context={{
        matterId: matter.id,
        color: matter.color,
        label: matter.name,
        sublabel: matter.caseNumber,
      }}
    >
      <TopBar
        title={matter.name}
        subtitle={
          <>
            <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-paper-2 text-ink-2 border-line">
              {matter.stage}
            </span>
            <span className="text-2xs text-ink-3">{matter.area}</span>
            {matter.restricted && <RestrictedBadge />}
          </>
        }
        actions={
          <>
            {/* The edit page hosts the matter form (`matters.edit`)
                and team management (`matters.manage_team`) — show the
                link when either half is usable. */}
            {(canEditMatter || canManageTeam) && (
              <Link
                href={`/matters/${matter.id}/edit`}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium bg-white text-ink-2 border border-line hover:border-brand-300 hover:text-brand-700 transition-colors"
              >
                <Pencil size={13} />
                Edit
              </Link>
            )}
            <PinToggle matterId={matter.id} initialPinned={matter.isPinnedByCurrentUser} />
            <EmailMuteToggle matterId={matter.id} initialMuted={emailMuted} />
            <MatterCreateMenu allowedTypes={allowedCreateTypes} />
          </>
        }
      />

      {/* ── Compact metadata strip ──────────────────────────────────── */}
      <div className="flex items-center gap-5 flex-wrap px-4 py-2 border-b border-line text-xs text-ink-3 animate-page-enter">
        <span className="flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: matter.color }}
          />
          {matter.caseNumber && (
            <span className="font-mono text-2xs text-ink-4">{matter.caseNumber}</span>
          )}
        </span>
        {matter.client && (
          <span>
            Client: <span className="text-ink font-medium">{matter.client.name}</span>
          </span>
        )}
        {matter.court && <span>{matter.court}</span>}
        <span>
          Billing: <span className="text-ink">{BILLING_TYPE_LABEL[billingTypeOf(matter)]}</span>
        </span>
        {leadMember && (
          <span>
            Lead: <span className="text-ink font-medium">{leadMember.user.name}</span>
          </span>
        )}
      </div>

      <MatterTabs
        matterId={matter.id}
        canViewBilling={canViewBilling}
        canViewRecords={canViewRecords}
      />

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto min-w-0">{children}</div>
        <CreateDock />
      </div>
    </CreateStackProvider>
  );
}
