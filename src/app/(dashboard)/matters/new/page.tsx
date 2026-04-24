/**
 * New Matter — placeholder
 *
 * The full create-matter form is a Phase 2 follow-up (needs: basic
 * fields, client picker / create-new flow, team assignment, stage +
 * area defaults, automation hookups). Route exists now so the
 * "New matter" button in the list header goes somewhere useful.
 */

import Link from "next/link";
import { TopBar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";

export default function NewMatterPage() {
  return (
    <>
      <TopBar title="New matter" crumbs="Matters / New" />
      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <div className="max-w-2xl">
          <Card>
            <CardContent className="p-8">
              <div className="text-sm font-semibold text-ink mb-2">
                Create-matter form coming soon
              </div>
              <div className="text-xs text-ink-3 leading-relaxed mb-4">
                The full form will capture: matter name + case number,
                practice area, stage, client (pick existing Contact or
                create a new one inline), opposing party + firm, court,
                fee structure, team assignments, and optional automations
                to run on creation (e.g. CGIA notice generation for §1983
                matters). Until that lands, matters are created via the
                seed script or Prisma Studio.
              </div>
              <Link
                href="/matters"
                className="text-xs text-brand-700 hover:underline"
              >
                ← Back to all matters
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
