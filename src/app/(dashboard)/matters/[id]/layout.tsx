/**
 * Matter Detail Layout
 *
 * Header + tab bar around every matter detail tab (Overview, Timeline,
 * Documents, Parties, Deadlines, Tasks, Notes, Billing). Fetches the
 * matter once here so each tab doesn't re-fetch the header data.
 *
 * Layout:
 *   TopBar        — crumb "Matters", title = matter name, stage chip +
 *                   area as subtitle, pin toggle in actions
 *   Metadata strip — compact one-line row: color dot, case number,
 *                   client, court, fee, lead
 *   Tab bar       — Overview, Timeline, Documents, …
 *   Tab content   — child route fills remaining height
 *
 * Next.js 16: dynamic route `params` is a Promise that must be awaited.
 */

import { notFound } from "next/navigation";
import { TopBar } from "@/components/layout/topbar";
import { MatterTabs } from "@/components/matters/matter-tabs";
import { PinToggle } from "@/components/matters/pin-toggle";
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
    <>
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
          <PinToggle
            matterId={matter.id}
            initialPinned={matter.isPinnedByCurrentUser}
          />
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

      <div className="flex-1 overflow-y-auto">{children}</div>
    </>
  );
}
