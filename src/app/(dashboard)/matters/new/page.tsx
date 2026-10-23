/**
 * New Matter page
 *
 * First-pass form for creating a matter. Fetches the dropdown options
 * (active client contacts + firm users) server-side and hands them to
 * the client form component. Submission goes through the
 * `createMatter` server action which creates the matter + assigns the
 * selected lead + optionally pins it for the creator, then redirects
 * to the new matter's detail page.
 */

import { attorneyUserWhere } from "@/lib/attorneys";
import { normalizeAreaBillingTypes } from "@/lib/billing-type";
import { TopBar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { NewMatterForm, type NewMatterDraft } from "@/components/matters/new-matter-form";
import { MatterDraftsList } from "@/components/matters/matter-drafts-list";
import { redirect } from "next/navigation";
import { loadAccessibleDraft } from "@/lib/draft-access";
import { listMatterDrafts } from "@/lib/queries/matter-drafts";
import { originatingDocLabel } from "@/lib/originating-doc";
import { activeStorageDriver } from "@/lib/file-storage";
import { dateOnlyKey } from "@/lib/format-date";
import { todayDateOnly } from "@/app/actions/billing/helpers";
import { prisma } from "@/lib/prisma";
import { toSolPeriod } from "@/lib/sol";
import { getCurrentFirm } from "@/lib/firm";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { DEFAULT_MATTER_NAME_TEMPLATE } from "@/lib/matter-name-template";
import { listVenues } from "@/lib/queries/venues";
import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";

export default async function NewMatterPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
} = {}) {
  // Same key `createMatter` enforces on submit: without it the form
  // could only fail (bouncing to "/" and discarding everything typed),
  // so redirect before rendering it. Also the session guard — this
  // page must authenticate itself (a layout is not a gate). Returns
  // the user id.
  const currentUserId = await requirePermission("matters.create");

  const params = await searchParams;
  const draftParam = params?.draft;
  const draftId = typeof draftParam === "string" && draftParam ? draftParam : null;
  const draftGone = params?.draftGone === "1";
  // Page-level scope check. A draft that is missing OR not visible gets the
  // same answer (no existence oracle): back to a fresh form with a notice.
  const draftRow = draftId ? await loadAccessibleDraft(currentUserId, draftId) : null;
  if (draftId && !draftRow) redirect("/matters/new?draftGone=1");

  const [
    areaRows,
    clients,
    users,
    leadUsers,
    canManageTeam,
    venueRows,
    firm,
    canAddVenue,
    timeZone,
    drafts,
    draftFileRows,
    canUpload,
    todayKey,
    gateFirm,
  ] = await Promise.all([
    prisma.practiceArea.findMany({
      where: { isActive: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        hasStatuteOfLimitations: true,
        statutePeriodAmount: true,
        statutePeriodUnit: true,
        statuteSourceCitation: true,
        matterNameTemplate: true,
        originatingDocLabel: true,
        requiredMatterFields: true,
        allowedBillingTypes: true,
        defaultBillingType: true,
        stages: {
          where: { isActive: true },
          orderBy: { order: "asc" },
          select: { id: true, name: true, order: true, isTerminal: true },
        },
      },
    }),
    prisma.contact.findMany({
      where: { type: "client", isActive: true },
      select: {
        id: true,
        name: true,
        organization: true,
        city: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, jobTitle: true, initials: true },
      orderBy: { name: "asc" },
    }),
    // Lead options: only attorneys (an active user with a bar admission).
    prisma.user.findMany({
      where: attorneyUserWhere,
      select: { id: true, name: true, jobTitle: true, initials: true },
      orderBy: { name: "asc" },
    }),
    currentUserHasPermission("matters.manage_team"),
    listVenues({ activeOnly: true }),
    getCurrentFirm(),
    currentUserHasPermission("venues.add"),
    getCurrentUserTimeZone(),
    listMatterDrafts(),
    draftRow
      ? prisma.matterDraftFile.findMany({
          where: { draftId: draftRow.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, isOriginating: true },
        })
      : Promise.resolve([]),
    currentUserHasPermission("documents.upload"),
    todayDateOnly().then(dateOnlyKey),
    prisma.user.findUnique({
      where: { id: currentUserId },
      select: { firm: { select: { requireOriginatingDoc: true } } },
    }),
  ]);

  const draft: NewMatterDraft | null = draftRow
    ? {
        id: draftRow.id,
        updatedAt: draftRow.updatedAt.toISOString(),
        values: Object.fromEntries(
          Object.entries((draftRow.values ?? {}) as Record<string, unknown>).filter(
            ([, v]) =>
              typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string")),
          ),
        ) as NewMatterDraft["values"],
        files: draftFileRows,
      }
    : null;
  const labelsByArea = Object.fromEntries(areaRows.map((a) => [a.id, originatingDocLabel(a)]));
  const venues = venueRows.map((v) => ({
    id: v.id,
    name: v.name,
    city: v.city,
    county: v.county,
    state: v.state,
    isActive: v.isActive,
  }));

  // Calendar period (ADR-035) as one serializable value for the forms.
  const areas = areaRows.map(({ statutePeriodAmount, statutePeriodUnit, ...a }) => {
    // Stored as plain strings; drop anything that isn't a known type.
    return {
      ...a,
      ...normalizeAreaBillingTypes(a),
      statutePeriod: toSolPeriod(statutePeriodAmount, statutePeriodUnit),
    };
  });

  return (
    <>
      <TopBar title="New matter" crumbs="Matters / New" />
      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <div className="max-w-3xl">
          {draftGone && (
            <div
              role="status"
              className="mb-3 rounded-md border border-warn-border bg-warn-soft px-3 py-2 text-xs font-medium text-warn"
            >
              That draft is no longer available.
            </div>
          )}
          <MatterDraftsList drafts={drafts} timeZone={timeZone} openDraftId={draft?.id ?? null} />
          <Card>
            <CardContent className="p-5">
              <NewMatterForm
                draft={draft}
                engagement={{
                  required: gateFirm?.firm?.requireOriginatingDoc ?? false,
                  canUpload,
                  labelsByArea,
                  defaultLabel: originatingDocLabel(null),
                  todayKey,
                  storageDriver: activeStorageDriver(),
                }}
                options={{
                  areas,
                  clients,
                  users,
                  leadUsers,
                  currentUserId,
                  canManageTeam,
                  venues,
                  canAddVenue,
                  firmState: firm.state ?? "",
                  firmTemplate: firm.matterNameTemplate ?? DEFAULT_MATTER_NAME_TEMPLATE,
                  timeZone,
                }}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
