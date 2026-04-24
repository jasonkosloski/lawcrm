/**
 * New Intake — placeholder
 *
 * The full intake form is a Phase 3 follow-up (needs: basic contact
 * fields, case summary, source capture, initial stage assignment,
 * automatic conflict check against existing Contacts + matters,
 * lead-score computation from liability/damages inputs). Route
 * exists now so the "New intake" button in the queue header goes
 * somewhere useful.
 */

import Link from "next/link";
import { TopBar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NewIntakePage() {
  return (
    <>
      <TopBar title="New intake" crumbs="Intake / New" />
      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <div className="max-w-2xl">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Intake form coming
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-xs text-ink-3 leading-relaxed mb-3">
                The full form will capture the initial inquiry end-to-end
                and run the intake-specific automations on submit.
              </p>
              <ul className="flex flex-col gap-1.5 text-xs text-ink-2 list-disc pl-4">
                <li>Prospective client name, email, phone</li>
                <li>Source + source detail (web form / referral / phone / walk-in / court appointment)</li>
                <li>Case summary, location, date of incident, injuries, prior-counsel flag</li>
                <li>Initial stage (new by default) and responsible intake coordinator</li>
                <li>
                  Automatic <strong>conflict check</strong> against existing
                  Contacts and opposing parties (result: clear / pending / warn
                  / conflict)
                </li>
                <li>
                  Initial <strong>lead-score</strong> compute from liability
                  and damages assessment inputs
                </li>
                <li>Statute window calculation from date of incident + practice area</li>
              </ul>
              <div className="mt-4 pt-3 border-t border-line text-2xs text-ink-4">
                Until the form lands, leads are created via the seed script
                or Prisma Studio. See <code className="font-mono text-ink-3">docs/FEATURES.md</code> for the full Phase 3 roadmap.
              </div>
              <div className="mt-3">
                <Link
                  href="/intake"
                  className="text-xs text-brand-700 hover:underline"
                >
                  ← Back to the intake queue
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
