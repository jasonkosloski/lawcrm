/**
 * Matter Detail Layout
 *
 * Shared header + tab bar around every matter detail tab (Overview,
 * Timeline, Documents, Parties, Deadlines, Tasks, Notes, Billing).
 * Fetches the matter once here so each tab doesn't re-fetch the
 * header data.
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
      <TopBar title={matter.name} crumbs={`Matters / ${matter.name}`} />

      {/* ── Matter header card ──────────────────────────────────────── */}
      <div className="px-5 pt-5 animate-page-enter">
        <div className="flex items-start gap-4">
          {/* Practice area color block */}
          <div
            className="w-1 self-stretch rounded-full shrink-0"
            style={{ background: matter.color }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-lg font-display font-medium text-ink">
                {matter.name}
              </h1>
              {matter.caseNumber && (
                <span className="text-2xs font-mono text-ink-4">
                  {matter.caseNumber}
                </span>
              )}
              <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-brand-soft text-brand-700 border-brand-200">
                {matter.stage}
              </span>
              <span className="text-2xs text-ink-3">{matter.area}</span>
              <div className="ml-auto">
                <PinToggle
                  matterId={matter.id}
                  initialPinned={matter.isPinnedByCurrentUser}
                />
              </div>
            </div>
            <div className="flex items-center gap-5 mt-1.5 text-xs text-ink-3">
              {matter.client && (
                <span>
                  Client:{" "}
                  <span className="text-ink font-medium">
                    {matter.client.name}
                  </span>
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
                  <span className="text-ink font-medium">
                    {leadMember.user.name}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────── */}
      <div className="mt-4">
        <MatterTabs matterId={matter.id} />
      </div>

      {/* ── Tab content ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">{children}</div>
    </>
  );
}
