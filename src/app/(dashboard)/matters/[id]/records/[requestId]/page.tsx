/**
 * Matter Records — one request's detail page. Auth + matter wall, then
 * records.view, then the shared body (a foreign or missing request id
 * 404s there).
 */

import { notFound } from "next/navigation";
import { RequestDetailPage } from "@/components/records-requests/request-detail-page";
import { requireUser } from "@/lib/current-user";
import { assertMatterAccess } from "@/lib/matter-access";
import { currentUserHasPermission } from "@/lib/permission-check";

export default async function MatterRecordsRequestPage({
  params,
}: PageProps<"/matters/[id]/records/[requestId]">) {
  await requireUser();
  const { id, requestId } = await params;
  await assertMatterAccess(id);
  if (!(await currentUserHasPermission("records.view"))) notFound();
  return (
    <div className="p-5">
      <RequestDetailPage
        scope={{ kind: "matter", matterId: id }}
        requestId={requestId}
        writable
      />
    </div>
  );
}
