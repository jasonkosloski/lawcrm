/**
 * Settings — Practice Area detail
 *
 * Two sections in one page:
 *   1. Area metadata form (name, label, color) — saved in place.
 *   2. Stage list — rename, reorder, mark terminal, archive/restore,
 *      plus an inline "add stage" input at the bottom.
 *
 * Matter counts surface on each stage so the admin can see where
 * matters are concentrated before making changes. Archive on a stage
 * with active matters is blocked server-side.
 *
 * Gated on `firm.manage_practice_areas` — admin always has it.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { EditPracticeAreaForm } from "@/components/settings/edit-practice-area-form";
import { StageManager } from "@/components/settings/stage-manager";

export default async function PracticeAreaDetailPage({
  params,
}: PageProps<"/settings/practice-areas/[id]">) {
  await requirePermission("firm.manage_practice_areas");
  const { id } = await params;
  const area = await prisma.practiceArea.findUnique({
    where: { id },
    include: {
      stages: {
        orderBy: [{ isActive: "desc" }, { order: "asc" }],
        select: {
          id: true,
          name: true,
          order: true,
          isTerminal: true,
          isActive: true,
          _count: {
            select: {
              matters: { where: { isArchived: false } },
            },
          },
        },
      },
    },
  });
  if (!area) notFound();

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <Link
        href="/settings/practice-areas"
        className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-brand-700 w-fit"
      >
        <ArrowLeft size={12} />
        All practice areas
      </Link>

      <div>
        <div className="flex items-center gap-2">
          <span
            className="w-4 h-4 rounded-full border border-line shrink-0"
            style={{ background: area.color }}
          />
          <h1 className="text-lg font-semibold text-ink">{area.name}</h1>
          {!area.isActive && (
            <span className="text-2xs text-ink-4 font-mono">archived</span>
          )}
        </div>
        {area.label && (
          <p className="text-xs text-ink-4 mt-0.5 ml-6">{area.label}</p>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Area settings
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <EditPracticeAreaForm
            area={{
              id: area.id,
              name: area.name,
              label: area.label,
              color: area.color,
              hasStatuteOfLimitations: area.hasStatuteOfLimitations,
              defaultBillingMode: area.defaultBillingMode,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              Case lifecycle stages
            </CardTitle>
            <span className="text-2xs text-ink-4 font-mono">
              {area.stages.filter((s) => s.isActive).length} active
            </span>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <StageManager
            practiceAreaId={area.id}
            stages={area.stages.map((s) => ({
              id: s.id,
              name: s.name,
              order: s.order,
              isTerminal: s.isTerminal,
              isActive: s.isActive,
              matterCount: s._count.matters,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
