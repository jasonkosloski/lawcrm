/**
 * Matter Detail — Parties tab
 *
 * Parties grouped into five coarse categories — Clients, Opposing
 * parties, Lay witnesses, Expert witnesses, and Others — each with
 * its own inline composer so the capture flow matches the rest of
 * the tabs. The optional `role` sub-field still rides along for
 * finer typing (plaintiff, defendant, opposing counsel, etc.).
 *
 * TODO (settings): firm-configurable category list, same pattern
 * as practice areas. For now categories are the hardcoded five
 * in src/lib/party-constants.ts.
 */

import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PartyComposer,
  type ContactOption,
} from "@/components/matters/parties/party-composer";
import { PartyRowView } from "@/components/matters/parties/party-row-view";
import { prisma } from "@/lib/prisma";
import { getMatterParties, type PartyRow } from "@/lib/queries/matter-detail";
import {
  PARTY_CATEGORIES,
  PARTY_CATEGORY_LABEL,
  type PartyCategory,
} from "@/lib/party-constants";

export default async function MatterPartiesPage({
  params,
}: PageProps<"/matters/[id]">) {
  const { id } = await params;

  const [parties, contacts] = await Promise.all([
    getMatterParties(id),
    // All active contacts feed the composer's typeahead. Small
    // dataset for a firm so passing them all is fine; revisit with
    // server search when the contact list grows past a few hundred.
    prisma.contact.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        organization: true,
        email: true,
        phone: true,
        city: true,
        type: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Bucket by category; unknown buckets (shouldn't happen after the
  // backfill migration) get dumped under "other" so nothing disappears.
  const byCategory = new Map<string, PartyRow[]>();
  for (const p of parties) {
    const cat = (PARTY_CATEGORIES as readonly string[]).includes(p.category)
      ? p.category
      : "other";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(p);
  }

  return (
    <div className="p-5 flex flex-col gap-5">
      {PARTY_CATEGORIES.map((category) => {
        const rows = byCategory.get(category) ?? [];
        return (
          <CategorySection
            key={category}
            category={category}
            rows={rows}
            matterId={id}
            contacts={contacts}
          />
        );
      })}
    </div>
  );
}

function CategorySection({
  category,
  rows,
  matterId,
  contacts,
}: {
  category: PartyCategory;
  rows: PartyRow[];
  matterId: string;
  contacts: ContactOption[];
}) {
  const showsRepresentation = category !== "client";
  // Clients are typically individuals whose organization (if any)
  // isn't the point of them being the client. Other categories
  // often ARE organizations (opposing firm, lienholder hospital…),
  // so keep the column there.
  const showsOrganization = category !== "client";
  // Primary client pins to the top of the clients section so the
  // Matter.clientId row is always visible at a glance.
  const sortedRows =
    category === "client"
      ? [...rows].sort(
          (a, b) => Number(b.isPrimaryClient) - Number(a.isPrimaryClient)
        )
      : rows;
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
          {PARTY_CATEGORY_LABEL[category]}
        </h2>
        <span className="text-2xs font-mono text-ink-4">{sortedRows.length}</span>
      </div>
      <Card className="p-0 overflow-hidden">
        {sortedRows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Subrole</TableHead>
                {showsOrganization && <TableHead>Organization</TableHead>}
                <TableHead>Contact</TableHead>
                {showsRepresentation && <TableHead>Represented by</TableHead>}
                <TableHead>Notes</TableHead>
                <TableHead className="pr-4 w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((p) => (
                <PartyRowView
                  key={p.id}
                  party={p}
                  category={category}
                  showsRepresentation={showsRepresentation}
                  showsOrganization={showsOrganization}
                  colSpan={
                    // name + subrole + contact + notes + actions = 5
                    5 +
                    (showsOrganization ? 1 : 0) +
                    (showsRepresentation ? 1 : 0)
                  }
                />
              ))}
            </TableBody>
          </Table>
        )}
        <CardContent className="px-4 py-3 border-t border-line">
          <PartyComposer
            matterId={matterId}
            category={category}
            contacts={contacts}
          />
        </CardContent>
      </Card>
    </section>
  );
}

