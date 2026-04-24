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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PartyComposer,
  type ContactOption,
} from "@/components/matters/parties/party-composer";
import { PartyRowActions } from "@/components/matters/parties/party-row-actions";
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
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
          {PARTY_CATEGORY_LABEL[category]}
        </h2>
        <span className="text-2xs font-mono text-ink-4">{rows.length}</span>
      </div>
      <Card className="p-0 overflow-hidden">
        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Subrole</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Contact</TableHead>
                {showsRepresentation && <TableHead>Represented by</TableHead>}
                <TableHead>Notes</TableHead>
                <TableHead className="pr-4 w-8" />
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
                  <TableCell className="text-2xs text-ink-3 capitalize">
                    {p.role ? p.role.replace(/_/g, " ") : "—"}
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
                  {showsRepresentation && (
                    <TableCell className="text-xs">
                      <RepresentationCell party={p} />
                    </TableCell>
                  )}
                  <TableCell className="text-xs text-ink-3 max-w-xs truncate">
                    {p.notes ?? "—"}
                  </TableCell>
                  <TableCell className="pr-4">
                    <PartyRowActions
                      matterContactId={p.id}
                      name={p.name}
                    />
                  </TableCell>
                </TableRow>
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

function RepresentationCell({ party }: { party: PartyRow }) {
  // Explicit pro se — distinct visual so it reads different from
  // "unknown" and doesn't silently fall back to the em-dash.
  if (party.isRepresented === false) {
    return (
      <span className="inline-block text-2xs font-medium px-1.5 py-0.5 rounded-full border bg-paper-2 text-ink-3 border-line">
        Pro se
      </span>
    );
  }
  // Represented and we have the rep's contact info — stack it.
  if (party.isRepresented === true && party.representationName) {
    return (
      <div className="flex flex-col leading-tight">
        <span className="text-ink font-medium truncate">
          {party.representationName}
        </span>
        {party.representationFirm && (
          <span className="text-2xs text-ink-3 truncate">
            {party.representationFirm}
          </span>
        )}
        {party.representationEmail && (
          <span className="text-2xs text-ink-4 truncate">
            {party.representationEmail}
          </span>
        )}
        {party.representationPhone && (
          <span className="text-2xs font-mono text-ink-4">
            {party.representationPhone}
          </span>
        )}
      </div>
    );
  }
  // Represented flag is true but no name yet — show a hint that
  // info's missing rather than going silent.
  if (party.isRepresented === true) {
    return (
      <span className="text-2xs text-ink-4 italic">
        Represented (details unknown)
      </span>
    );
  }
  // Null = unknown — em-dash so collapse looks clean.
  return <span className="text-ink-4">—</span>;
}
