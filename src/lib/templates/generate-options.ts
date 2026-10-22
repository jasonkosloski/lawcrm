/**
 * Signer and recipient options for the generate-from-template dialog.
 *
 * Mirrors the sets `loadTemplateData` accepts so the picker never offers a
 * choice the server would refuse:
 *   - matter recipients: contacts linked by MatterContact, Matter.clientId,
 *     and an opposing party's representation contact (opposing counsel);
 *   - lead recipient: Lead.contactId;
 *   - signer: the current user or any active team member.
 * Access-checked here (assertScopeAccess) before any query, even though
 * the calling page already ran its own guard.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { assertScopeAccess } from "@/lib/scope-access";
import type { RecordScope } from "@/lib/record-scope";

export type SignerOption = { id: string; name: string };
export type RecipientOption = { id: string; name: string; role: string | null };
export type GenerateOptions = {
  team: SignerOption[];
  contacts: RecipientOption[];
  currentUserId: string;
};

const words = (s: string) => s.replace(/_/g, " ");

export async function loadGenerateOptions(scope: RecordScope): Promise<GenerateOptions> {
  await assertScopeAccess(scope);
  const currentUserId = await getCurrentUserId();

  const contacts = new Map<string, RecipientOption>();
  const add = (id: string, name: string, role: string | null) => {
    if (!contacts.has(id)) contacts.set(id, { id, name, role });
  };
  let teamUsers: SignerOption[];

  if (scope.kind === "matter") {
    const matter = await prisma.matter.findUnique({
      where: { id: scope.matterId },
      select: {
        client: { select: { id: true, name: true } },
        contacts: {
          orderBy: { createdAt: "asc" },
          select: {
            category: true,
            role: true,
            contact: { select: { id: true, name: true } },
            representationContact: { select: { id: true, name: true } },
          },
        },
        teamMembers: {
          where: { removedAt: null },
          select: { user: { select: { id: true, name: true } } },
        },
      },
    });
    if (matter?.client) add(matter.client.id, matter.client.name, "client");
    for (const mc of matter?.contacts ?? []) {
      add(mc.contact.id, mc.contact.name, words(mc.role?.trim() || mc.category));
    }
    for (const mc of matter?.contacts ?? []) {
      if (mc.category === "opposing" && mc.representationContact) {
        add(mc.representationContact.id, mc.representationContact.name, "opposing counsel");
      }
    }
    teamUsers = (matter?.teamMembers ?? []).map((t) => t.user);
  } else {
    const lead = await prisma.lead.findUnique({
      where: { id: scope.leadId },
      select: {
        contact: { select: { id: true, name: true } },
        teamMembers: { select: { user: { select: { id: true, name: true } } } },
      },
    });
    if (lead?.contact) add(lead.contact.id, lead.contact.name, "client");
    teamUsers = (lead?.teamMembers ?? []).map((t) => t.user);
  }

  const me = await prisma.user.findUnique({
    where: { id: currentUserId },
    select: { id: true, name: true },
  });
  const team = new Map<string, SignerOption>();
  if (me) team.set(me.id, me);
  for (const u of teamUsers) team.set(u.id, u);

  return {
    team: [...team.values()].sort((a, b) => a.name.localeCompare(b.name)),
    contacts: [...contacts.values()],
    currentUserId,
  };
}
