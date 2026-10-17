/**
 * New Intake — records a new inquiry (`createLead`, gated
 * `intake.create`). The person links to an existing contact or a new
 * one is created; a conflict check runs on save and the user lands on
 * the lead page with the result.
 */

import Link from "next/link";
import { TopBar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { NewIntakeForm } from "@/components/intake/new-intake-form";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";

export default async function NewIntakePage() {
  await requirePermission("intake.create");

  // Every active, unmerged contact — a repeat caller may already be on
  // file as a client, witness, or anything else. (ADR-039 trade-off:
  // contacts are a firm-wide directory, findable by name.)
  const contacts = await prisma.contact.findMany({
    where: { isActive: true, mergedIntoId: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, phone: true, type: true },
  });

  return (
    <>
      <TopBar title="New intake" crumbs="Intake / New" />
      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <div className="max-w-2xl flex flex-col gap-3">
          <Card>
            <CardContent className="p-4 sm:p-5">
              <NewIntakeForm contacts={contacts} />
            </CardContent>
          </Card>
          <Link href="/intake" className="text-xs text-brand-700 hover:underline self-start">
            ← Back to the intake queue
          </Link>
        </div>
      </div>
    </>
  );
}
