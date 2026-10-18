/**
 * Settings — Records request types.
 *
 * Firm-admin surface for the request types (name, statutory response
 * period, chase interval, default letter template). Gated on
 * `records.types.manage`; the nav link is hidden without it.
 */

import { notFound } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { listRecordsRequestTypes } from "@/lib/queries/records-requests";
import { RequestTypeEditor } from "@/components/records-requests/request-type-editor";

export default async function RecordsTypesPage() {
  await requireUser();
  if (!(await currentUserHasPermission("records.types.manage"))) notFound();

  const [types, templates] = await Promise.all([
    listRecordsRequestTypes({ activeOnly: false }),
    prisma.documentTemplate.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-ink">Records request types</h1>
        <p className="text-xs text-ink-4 mt-1 leading-relaxed">
          Configure the kinds of records requests your firm sends. Each type
          can carry a statutory response period, how often to chase, and a
          default request-letter template. Archive a type to remove it from
          pickers while keeping history intact.
        </p>
      </div>
      <RequestTypeEditor types={types} templates={templates} />
    </div>
  );
}
