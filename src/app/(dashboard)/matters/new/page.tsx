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

import { TopBar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import {
  NewMatterForm,
  type NewMatterDraft,
} from "@/components/matters/new-matter-form";
import { MatterDraftsList } from "@/components/matters/matter-drafts-list";
import { assertDraftAccess } from "@/lib/draft-access";
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
import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";

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

  const draftParam = (await searchParams)?.draft;
  const draftId = typeof draftParam === "string" && draftParam ? draftParam : null;
  // Page-level scope check: a draft you can't see is a 404, not a form.
  const draftRow = draftId ? await assertDraftAccess(draftId) : null;

  const [
    areaRows,
    clients,
    users,
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
              typeof v === "string" ||
              (Array.isArray(v) && v.every((x) => typeof x === "string"))
          )
        ) as NewMatterDraft["values"],
        files: draftFileRows,
      }
    : null;
  const labelsByArea = Object.fromEntries(
    areaRows.map((a) => [a.id, originatingDocLabel(a)])
  );
  const venues = venueRows.map((v) => ({
    id: v.id,
    name: v.name,
    city: v.city,
    county: v.county,
    state: v.state,
    isActive: v.isActive,
  }));

  // Calendar period (ADR-035) as one serializable value for the forms.
  const areas = areaRows.map(
    ({ statutePeriodAmount, statutePeriodUnit, ...a }) => ({
      ...a,
      statutePeriod: toSolPeriod(statutePeriodAmount, statutePeriodUnit),
    })
  );

  return (
    <>
      <TopBar title="New matter" crumbs="Matters / New" />
      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <div className="max-w-3xl">
          <MatterDraftsList
            drafts={drafts}
            timeZone={timeZone}
            openDraftId={draft?.id ?? null}
          />
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
