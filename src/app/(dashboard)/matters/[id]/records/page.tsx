/**
 * Matter Detail — Records tab. Auth + matter wall, then records.view,
 * then the shared tab (see src/components/records-requests/records-tab.tsx).
 */

import { notFound } from "next/navigation";
import { RecordsTab } from "@/components/records-requests/records-tab";
import { requireUser } from "@/lib/current-user";
import { assertMatterAccess } from "@/lib/matter-access";
import { currentUserHasPermission } from "@/lib/permission-check";

export default async function MatterRecordsPage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/records">) {
  // Pages guard themselves: layouts don't re-run on soft navigation (ADR-028).
  await requireUser();
  const { id } = await params;
  await assertMatterAccess(id);
  if (!(await currentUserHasPermission("records.view"))) notFound();
  const sp = await searchParams;
  const raw = Array.isArray(sp.request) ? sp.request[0] : sp.request;
  return (
    <div className="p-5">
      <RecordsTab
        scope={{ kind: "matter", matterId: id }}
        requestParam={typeof raw === "string" ? raw : null}
        writable
      />
    </div>
  );
}
