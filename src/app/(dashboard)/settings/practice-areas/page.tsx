/**
 * Settings — Practice Areas list
 *
 * Firm-admin surface for configuring the practice-area lookup the
 * matter forms, sidebar, and stage-changer all draw from. Shows active
 * areas at the top and archived ones below; each row links to the
 * detail page for stage management. Includes an inline "add area"
 * form that auto-seeds the default 10-stage lifecycle.
 *
 * Gated on `firm.manage_practice_areas` — anyone with that
 * permission (admin always) can land here; the nav link is
 * hidden in SettingsNav for users without it.
 */

import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { CreatePracticeAreaForm } from "@/components/settings/create-practice-area-form";
import { PracticeAreaRowActions } from "@/components/settings/practice-area-row-actions";

export default async function PracticeAreasSettingsPage() {
  await requirePermission("firm.manage_practice_areas");
  const areas = await prisma.practiceArea.findMany({
    orderBy: [{ isActive: "desc" }, { order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      label: true,
      color: true,
      order: true,
      isActive: true,
      _count: {
        select: {
          stages: { where: { isActive: true } },
          matters: { where: { isArchived: false } },
        },
      },
    },
  });

  const active = areas.filter((a) => a.isActive);
  const archived = areas.filter((a) => !a.isActive);

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-ink">Practice areas</h1>
        <p className="text-xs text-ink-4 mt-1 leading-relaxed">
          Configure the practice areas your firm takes. Each area has its
          own case-lifecycle stages, which new matters progress through.
          Archive an area to remove it from new-matter dropdowns while
          keeping historical matters intact.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            <div className="flex items-center gap-2">
              <Plus size={14} />
              Add a practice area
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <CreatePracticeAreaForm />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-2">
        <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          Active ({active.length})
        </div>
        {active.length === 0 ? (
          <Card>
            <CardContent className="px-4 py-6 text-xs text-ink-4">
              No active practice areas. Add one above to get started.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-1.5">
            {active.map((a) => (
              <AreaRow key={a.id} area={a} />
            ))}
          </div>
        )}
      </section>

      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Archived ({archived.length})
          </div>
          <div className="flex flex-col gap-1.5">
            {archived.map((a) => (
              <AreaRow key={a.id} area={a} muted />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

type AreaRowData = {
  id: string;
  name: string;
  label: string | null;
  color: string;
  isActive: boolean;
  _count: { stages: number; matters: number };
};

function AreaRow({ area, muted }: { area: AreaRowData; muted?: boolean }) {
  return (
    <div
      className={
        "flex items-center gap-3 px-3 py-2.5 rounded-md border border-line bg-white" +
        (muted ? " opacity-70" : "")
      }
    >
      <span
        className="w-3 h-3 rounded-full shrink-0 border border-line"
        style={{ background: area.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/settings/practice-areas/${area.id}`}
            className="text-xs font-medium text-ink hover:text-brand-700 truncate"
          >
            {area.name}
          </Link>
          {!area.isActive && (
            <span className="text-2xs text-ink-4 font-mono">archived</span>
          )}
        </div>
        {area.label && (
          <div className="text-2xs text-ink-4 truncate">{area.label}</div>
        )}
      </div>

      <div className="hidden sm:flex flex-col items-end text-2xs text-ink-4 font-mono">
        <span>{area._count.stages} stages</span>
        <span>{area._count.matters} matters</span>
      </div>

      <PracticeAreaRowActions
        areaId={area.id}
        isActive={area.isActive}
        activeMatterCount={area._count.matters}
      />

      <Link
        href={`/settings/practice-areas/${area.id}`}
        className="inline-flex items-center h-7 px-2 rounded-md text-xs text-ink-3 hover:text-brand-700 hover:bg-brand-soft transition-colors"
      >
        Manage
        <ChevronRight size={13} />
      </Link>
    </div>
  );
}
