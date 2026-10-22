/**
 * Settings — Court formats.
 *
 * Per-court layout overrides and block swaps for filings, applied through
 * a venue's court format. Visible to anyone holding any court-format key;
 * the list shows each control only with its own key.
 */

import { notFound } from "next/navigation";
import { CourtFormatList } from "@/components/settings/court-format-list";
import { requireUser } from "@/lib/current-user";
import { currentUserHasAnyPermission, currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import type { CourtSystem } from "@/lib/templates/page-style";

export default async function CourtFormatsPage() {
  await requireUser();
  if (
    !(await currentUserHasAnyPermission([
      "court_formats.add",
      "court_formats.edit",
      "court_formats.delete",
    ]))
  ) {
    notFound();
  }

  const [rows, canAdd, canEdit, canDelete] = await Promise.all([
    prisma.courtFormat.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        courtSystem: true,
        isActive: true,
        _count: { select: { venues: true } },
      },
    }),
    currentUserHasPermission("court_formats.add"),
    currentUserHasPermission("court_formats.edit"),
    currentUserHasPermission("court_formats.delete"),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Court formats</h1>
        <p className="mt-1 text-xs leading-relaxed text-ink-4">
          How filings look in a particular court: paper size, font, spacing, margins, page numbers
          and swapped blocks such as the caption. Pick a format on a venue and filings for matters
          in that venue use it. Anything left on the house style follows Settings → Documents.
        </p>
      </div>
      <CourtFormatList
        formats={rows.map(({ _count, courtSystem, ...f }) => ({
          ...f,
          courtSystem: courtSystem as CourtSystem,
          venueCount: _count.venues,
        }))}
        canAdd={canAdd}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
