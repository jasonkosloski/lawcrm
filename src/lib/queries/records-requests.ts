/**
 * Read-side queries for the Records Requests module. Later tasks add
 * more queries here; for now just the request-type list.
 */

import { prisma } from "@/lib/prisma";

export type RecordsRequestTypeRow = {
  id: string;
  name: string;
  responseAmount: number | null;
  responseUnit: "CALENDAR_DAYS" | "BUSINESS_DAYS" | null;
  followUpDays: number;
  defaultTemplateId: string | null;
  defaultTemplateName: string | null;
  isActive: boolean;
  sortOrder: number;
};

/** Request types ordered by sortOrder then name (id as final tiebreak). */
export async function listRecordsRequestTypes(opts: {
  activeOnly: boolean;
}): Promise<RecordsRequestTypeRow[]> {
  const rows = await prisma.recordsRequestType.findMany({
    where: opts.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      responseAmount: true,
      responseUnit: true,
      followUpDays: true,
      defaultTemplateId: true,
      isActive: true,
      sortOrder: true,
      defaultTemplate: { select: { name: true } },
    },
  });
  return rows.map(({ defaultTemplate, ...r }) => ({
    ...r,
    defaultTemplateName: defaultTemplate?.name ?? null,
  }));
}
