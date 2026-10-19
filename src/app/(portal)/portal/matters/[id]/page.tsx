/** A single invited matter: requests, shared documents and the client's uploads. */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  assertPortalMatterAccess,
  portalMatterWhere,
  requirePortalIdentity,
} from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";
import { activeStorageDriver } from "@/lib/file-storage";
import {
  listPortalSharedDocuments,
  listPortalUploads,
} from "@/lib/portal/document-visibility.server";
import { listPortalRequests } from "@/lib/portal/requests";
import { MatterStatus } from "../../matter-status";
import { RequestsSection } from "./requests-section";
import { SharedSection } from "./shared-section";
import { UploadsSection } from "./uploads-section";

export default async function PortalMatterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { identityId } = await requirePortalIdentity();
  const { id } = await params;
  await assertPortalMatterAccess(identityId, id);

  const matter = await prisma.matter.findFirst({
    where: { id, ...portalMatterWhere(identityId) },
    select: { id: true, name: true, isArchived: true },
  });
  if (!matter) notFound();

  const [requests, shared, uploads] = await Promise.all([
    listPortalRequests(identityId, id),
    listPortalSharedDocuments(identityId, id),
    listPortalUploads(identityId, id),
  ]);
  const storageDriver = activeStorageDriver();

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/"
        className="-ml-1 inline-flex items-center gap-1 self-start rounded-md px-1 py-0.5 text-sm text-ink-3 outline-none hover:text-brand-700 focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        My matters
      </Link>

      <div className="flex flex-col items-start gap-3">
        <MatterStatus closed={matter.isArchived} />
        <h1 className="font-display text-3xl font-medium tracking-tight text-balance text-brand-900">
          {matter.name}
        </h1>
      </div>

      <RequestsSection
        requests={requests}
        matterId={matter.id}
        storageDriver={storageDriver}
      />
      <SharedSection documents={shared} />
      <UploadsSection
        uploads={uploads}
        matterId={matter.id}
        storageDriver={storageDriver}
      />
    </div>
  );
}
