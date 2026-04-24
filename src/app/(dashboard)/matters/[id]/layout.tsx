/**
 * Matter Detail Layout
 *
 * Header + tab bar + optional Create dock around every matter detail
 * tab. Fetches the matter once here so each tab doesn't re-fetch the
 * header data, and wraps everything in `MatterCreateStackProvider` so
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

import { notFound } from "next/navigation";
import { TopBar } from "@/components/layout/topbar";
import { MatterTabs } from "@/components/matters/matter-tabs";
import { PinToggle } from "@/components/matters/pin-toggle";
import { MatterCreateMenu } from "@/components/matters/matter-create-menu";
import { MatterCreateDock } from "@/components/matters/matter-create-dock";
import { MatterCreateStackProvider } from "@/components/matters/matter-create-stack-provider";
import { getMatterById } from "@/lib/queries/matters";

const FEE_LABEL: Record<string, string> = {
  contingent: "Contingent",
  hourly: "Hourly",
  flat: "Flat fee",
  hybrid: "Hybrid",
  pro_bono: "Pro bono",
};

export default async function MatterDetailLayout({
  children,
  params,
}: LayoutProps<"/matters/[id]">) {
  const { id } = await params;
  const matter = await getMatterById(id);
  if (!matter) notFound();

  const leadMember = matter.teamMembers.find((t) => t.role === "lead");

  return (
    <MatterCreateStackProvider
      matterId={matter.id}
      matterName={matter.name}
      matterCaseNumber={matter.caseNumber}
      matterColor={matter.color}
    >
      <TopBar
        title={matter.name}
        crumbs="Matters"
        subtitle={
          <>
            <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-brand-soft text-brand-700 border-brand-200">
              {matter.stage}
            </span>
            <span className="text-2xs text-ink-3">{matter.area}</span>
          </>
        }
        actions={
          <>
            <PinToggle
              matterId={matter.id}
              initialPinned={matter.isPinnedByCurrentUser}
            />
            <MatterCreateMenu />
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
            <span className="font-mono text-2xs text-ink-4">
              {matter.caseNumber}
            </span>
          )}
        </span>
        {matter.client && (
          <span>
            Client:{" "}
            <span className="text-ink font-medium">{matter.client.name}</span>
          </span>
        )}
        {matter.court && <span>{matter.court}</span>}
        <span>
          Fee:{" "}
          <span className="text-ink">
            {FEE_LABEL[matter.feeStructure] ?? matter.feeStructure}
          </span>
        </span>
        {leadMember && (
          <span>
            Lead:{" "}
            <span className="text-ink font-medium">{leadMember.user.name}</span>
          </span>
        )}
      </div>

      <MatterTabs matterId={matter.id} />

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto min-w-0">{children}</div>
        <MatterCreateDock />
      </div>
    </MatterCreateStackProvider>
  );
}
