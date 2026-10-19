/** Portal home: the matters this identity has been invited to. */

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { portalMatterWhere, requirePortalIdentity } from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";

export default async function PortalHome() {
  const { identityId } = await requirePortalIdentity();

  const matters = await prisma.matter.findMany({
    where: portalMatterWhere(identityId),
    select: { id: true, name: true, isArchived: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">My matters</h1>
      {matters.length === 0 ? (
        <p className="text-sm text-ink-3">You have no matters yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {matters.map((m) => (
            <li key={m.id}>
              <Link href={`/matters/${m.id}`} className="block">
                <Card className="flex-row items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 truncate font-medium">{m.name}</span>
                  <span className="shrink-0 text-2xs font-mono uppercase tracking-wider text-ink-3">
                    {m.isArchived ? "Closed" : "Open"}
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
