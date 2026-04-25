/**
 * Edit Matter page
 *
 * Reached via the "Edit" button in the matter detail TopBar. Fetches
 * the current matter + form-option lists server-side, renders the
 * EditMatterForm which submits to the `updateMatter` server action.
 *
 * Inherits the parent matter-detail layout (TopBar + metadata strip +
 * tab bar), so the edit surface feels like a proper tab-scoped view
 * rather than a disconnected page. The Cancel + Save buttons route
 * back to the matter detail.
 */

import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import {
  EditMatterForm,
  type MatterForEdit,
} from "@/components/matters/edit-matter-form";
import { prisma } from "@/lib/prisma";

export default async function EditMatterPage({
  params,
}: PageProps<"/matters/[id]/edit">) {
  const { id } = await params;

  const [matter, areas, clients, users] = await Promise.all([
    prisma.matter.findUnique({
      where: { id },
      include: {
        teamMembers: {
          where: { role: "lead" },
          select: { userId: true },
          take: 1,
        },
      },
    }),
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
      select: { id: true, name: true, organization: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, jobTitle: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!matter) notFound();

  const forEdit: MatterForEdit = {
    id: matter.id,
    name: matter.name,
    caseNumber: matter.caseNumber,
    practiceAreaId: matter.practiceAreaId,
    stageId: matter.stageId,
    feeStructure: matter.feeStructure,
    court: matter.court,
    clientId: matter.clientId,
    opposingParty: matter.opposingParty,
    opposingFirm: matter.opposingFirm,
    description: matter.description,
    leadUserId: matter.teamMembers[0]?.userId ?? null,
    statuteOfLimitationsDate: matter.statuteOfLimitationsDate,
    statuteOfLimitationsNotes: matter.statuteOfLimitationsNotes,
  };

  return (
    <div className="p-5">
      <div className="max-w-3xl">
        <Card>
          <CardContent className="p-5">
            <EditMatterForm
              matter={forEdit}
              options={{ areas, clients, users }}
            />
          </CardContent>
        </Card>

        <div className="text-2xs text-ink-4 mt-3">
          Non-lead team assignments, archiving, and deletion are
          separate actions — see the Matter Actions menu (coming).
        </div>
      </div>
    </div>
  );
}
