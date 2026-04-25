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
import { NewMatterForm } from "@/components/matters/new-matter-form";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

export default async function NewMatterPage() {
  const [areas, clients, users, currentUserId] = await Promise.all([
    prisma.practiceArea.findMany({
      where: { isActive: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        hasStatuteOfLimitations: true,
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
        state: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, jobTitle: true, initials: true },
      orderBy: { name: "asc" },
    }),
    getCurrentUserId(),
  ]);

  return (
    <>
      <TopBar title="New matter" crumbs="Matters / New" />
      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <div className="max-w-3xl">
          <Card>
            <CardContent className="p-5">
              <NewMatterForm
                options={{ areas, clients, users, currentUserId }}
              />
            </CardContent>
          </Card>

          <div className="text-2xs text-ink-4 mt-3">
            First-pass form. Team assignment beyond the lead, tagging
            to existing leads, automation hookups (CGIA notice
            generation for §1983, etc.), and inline client creation
            are all follow-ups.
          </div>
        </div>
      </div>
    </>
  );
}
