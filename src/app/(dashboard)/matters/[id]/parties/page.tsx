/**
 * Matter Detail — Parties tab
 *
 * People and organizations involved in this matter, grouped by role.
 * Includes plaintiffs, defendants, witnesses, experts, opposing
 * counsel, lienholders, medical providers, and judges.
 */

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getMatterParties, type PartyRow } from "@/lib/queries/matter-detail";

/** Preferred display order for roles. Unknown roles fall to the end. */
const ROLE_ORDER = [
  "plaintiff",
  "defendant",
  "opposing_counsel",
  "witness",
  "expert",
  "judge",
  "guardian_ad_litem",
  "medical_provider",
  "lienholder",
];

const ROLE_LABEL: Record<string, string> = {
  plaintiff: "Plaintiff",
  defendant: "Defendant",
  opposing_counsel: "Opposing counsel",
  witness: "Witness",
  expert: "Expert",
  judge: "Judge",
  guardian_ad_litem: "GAL",
  medical_provider: "Medical provider",
  lienholder: "Lienholder",
};

const CONTACT_TYPE_LABEL: Record<string, string> = {
  client: "Client",
  opposing_counsel: "Opposing",
  witness: "Witness",
  expert: "Expert",
  judge: "Judge",
  court: "Court",
  vendor: "Vendor",
  medical_provider: "Medical",
  government: "Government",
  other: "Other",
};

export default async function MatterPartiesPage({
  params,
}: PageProps<"/matters/[id]">) {
  const { id } = await params;
  const parties = await getMatterParties(id);

  if (parties.length === 0) {
    return (
      <div className="p-5">
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-sm font-semibold text-ink mb-1">
              No parties yet
            </div>
            <div className="text-xs text-ink-3">
              Contacts linked to this matter will appear here — plaintiffs,
              defendants, witnesses, experts, opposing counsel, and more.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Group by role, preserving `ROLE_ORDER` first and appending any unknowns.
  const byRole = new Map<string, PartyRow[]>();
  for (const p of parties) {
    if (!byRole.has(p.role)) byRole.set(p.role, []);
    byRole.get(p.role)!.push(p);
  }
  const orderedRoles = [
    ...ROLE_ORDER.filter((r) => byRole.has(r)),
    ...[...byRole.keys()].filter((r) => !ROLE_ORDER.includes(r)),
  ];

  return (
    <div className="p-5 flex flex-col gap-5">
      {orderedRoles.map((role) => {
        const rows = byRole.get(role)!;
        return (
          <section key={role}>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
                {ROLE_LABEL[role] ?? role}
              </h2>
              <span className="text-2xs font-mono text-ink-4">
                {rows.length}
              </span>
            </div>
            <Card className="p-0 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="pr-4">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="pl-4 font-medium text-ink">
                        <div className="flex items-center gap-2">
                          <span>{p.name}</span>
                          {p.conflictStatus === "flagged" && (
                            <span className="text-2xs font-medium px-1.5 py-0.5 rounded-full bg-warn-soft text-warn border border-warn-border">
                              conflict flagged
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-ink-3">
                        {p.organization ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-ink-3">
                        <div className="flex flex-col leading-tight">
                          {p.email && <span>{p.email}</span>}
                          {p.phone && (
                            <span className="font-mono text-2xs text-ink-4">
                              {p.phone}
                            </span>
                          )}
                          {!p.email && !p.phone && "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-2xs text-ink-3">
                        {CONTACT_TYPE_LABEL[p.contactType] ?? p.contactType}
                      </TableCell>
                      <TableCell className="pr-4 text-xs text-ink-3 max-w-xs truncate">
                        {p.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </section>
        );
      })}
    </div>
  );
}
