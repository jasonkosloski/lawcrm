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
import { toSolPeriod } from "@/lib/sol";
import { requirePermission } from "@/lib/permission-check";

export default async function NewMatterPage() {
  // Same key `createMatter` enforces on submit: without it the form
  // could only fail (bouncing to "/" and discarding everything typed),
  // so redirect before rendering it. Also the session guard — this
  // page must authenticate itself (a layout is not a gate). Returns
  // the user id.
  const currentUserId = await requirePermission("matters.create");

  const [areaRows, clients, users] = await Promise.all([
    prisma.practiceArea.findMany({
      where: { isActive: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        hasStatuteOfLimitations: true,
        statutePeriodAmount: true,
        statutePeriodUnit: true,
        statuteSourceCitation: true,
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
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, jobTitle: true, initials: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Calendar period (ADR-035) as one serializable value for the forms.
  const areas = areaRows.map(
    ({ statutePeriodAmount, statutePeriodUnit, ...a }) => ({
      ...a,
      statutePeriod: toSolPeriod(statutePeriodAmount, statutePeriodUnit),
    })
  );

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
