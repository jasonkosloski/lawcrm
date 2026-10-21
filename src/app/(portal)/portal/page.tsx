/** Portal home: the matters this identity has been invited to. */

import Link from "next/link";
import { Briefcase, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { portalMatterWhere, requirePortalIdentity } from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";
import { countOpenRequestsByMatter } from "@/lib/portal/requests";
import { unreadPortalMessageMatters } from "@/lib/portal/messages";
import { latestStageLabels } from "@/lib/portal/status";
import { MatterStatus } from "./matter-status";

export default async function PortalHome() {
  const { identityId, contactId } = await requirePortalIdentity();

  const [contact, matters, openCounts] = await Promise.all([
    prisma.contact.findUnique({
      where: { id: contactId },
      select: { name: true },
    }),
    prisma.matter.findMany({
      where: portalMatterWhere(identityId),
      select: { id: true, name: true, isArchived: true },
      orderBy: { name: "asc" },
    }),
    countOpenRequestsByMatter(identityId),
  ]);

  const matterIds = matters.map((m) => m.id);
  const [stageLabels, unread] = await Promise.all([
    latestStageLabels(identityId, matterIds),
    unreadPortalMessageMatters(identityId, matterIds),
  ]);
  const open = matters.filter((m) => !m.isArchived);
  const closed = matters.filter((m) => m.isArchived);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-medium tracking-tight text-brand-900">
          {contact?.name ? `Welcome, ${contact.name}` : "Welcome"}
        </h1>
        <p className="text-sm text-ink-3">
          Choose a matter to see what your legal team has shared with you.
        </p>
      </div>

      {matters.length === 0 ? (
        <EmptyState
          framed
          icon={Briefcase}
          title="No matters shared with you yet"
          description="Your legal team will email you when a matter is ready to view here."
          className="bg-white py-12"
        />
      ) : (
        <>
          {open.length > 0 ? (
            <MatterList
              heading="My matters"
              matters={open}
              openCounts={openCounts}
              stageLabels={stageLabels}
              unread={unread}
            />
          ) : null}
          {closed.length > 0 ? (
            <MatterList
              heading="Closed matters"
              matters={closed}
              openCounts={openCounts}
              stageLabels={stageLabels}
              unread={unread}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function MatterList({
  heading,
  matters,
  openCounts,
  stageLabels,
  unread,
}: {
  heading: string;
  openCounts: Map<string, number>;
  stageLabels: Map<string, string>;
  unread: Set<string>;
  matters: { id: string; name: string; isArchived: boolean }[];
}) {
  const id = `${heading.toLowerCase().replace(/\s+/g, "-")}-heading`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-sm font-semibold text-ink-2">
        {heading}
      </h2>
      <ul className="divide-y divide-line-2 overflow-hidden rounded-xl bg-white shadow-xs ring-1 ring-line">
        {matters.map((m) => (
          <li key={m.id}>
            <Link
              href={`/matters/${m.id}`}
              className="group flex min-h-16 items-center gap-4 px-5 py-4 outline-none transition-colors hover:bg-brand-tint focus-visible:bg-brand-tint focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset"
            >
              <span className="min-w-0 flex-1 truncate font-display text-base font-medium text-ink group-hover:text-brand-700">
                {m.name}
              </span>
              {(openCounts.get(m.id) ?? 0) > 0 ? (
                <span className="shrink-0 rounded-full border border-warn-border bg-warn-soft px-2.5 py-0.5 text-xs font-medium text-warn">
                  {openCounts.get(m.id) === 1
                    ? "1 item requested"
                    : `${openCounts.get(m.id)} items requested`}
                </span>
              ) : null}
              {unread.has(m.id) ? (
                <span className="shrink-0 rounded-full border border-brand-200 bg-brand-tint px-2.5 py-0.5 text-xs font-medium text-brand-700">
                  New message
                </span>
              ) : null}
              {stageLabels.get(m.id) ? (
                <span className="max-w-[40%] shrink-0 truncate text-sm text-ink-3">
                  {stageLabels.get(m.id)}
                </span>
              ) : null}
              <MatterStatus closed={m.isArchived} />
              <ChevronRight
                className="size-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
