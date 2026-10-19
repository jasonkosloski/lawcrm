/** A single invited matter. Foundation stage: name and open/closed only. */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Inbox } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import {
  assertPortalMatterAccess,
  portalMatterWhere,
  requirePortalIdentity,
} from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";
import { MatterStatus } from "../../matter-status";

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

      <EmptyState
        framed
        icon={Inbox}
        title="Nothing shared yet"
        description="Updates your legal team shares about this matter will appear here. For anything urgent, call or email the office."
        className="bg-white py-12"
      />
    </div>
  );
}
