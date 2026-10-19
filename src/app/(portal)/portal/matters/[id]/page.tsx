/** A single invited matter. Foundation stage: name only. */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import {
  assertPortalMatterAccess,
  portalMatterWhere,
  requirePortalIdentity,
} from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";

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
    <div className="flex flex-col gap-4">
      <Link href="/" className="text-sm text-ink-3 hover:text-ink">
        &larr; My matters
      </Link>
      <Card className="gap-2 px-4 py-4">
        <h1 className="text-xl font-semibold">{matter.name}</h1>
        <p className="text-sm text-ink-3">More details are coming soon.</p>
      </Card>
    </div>
  );
}
