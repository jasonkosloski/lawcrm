/**
 * Contacts directory.
 *
 * Searchable list of every active contact in the firm — clients,
 * opposing counsel, witnesses, experts, courts, vendors, providers.
 * URL-driven `?q=` and `?type=` so filters survive refresh and can
 * be shared.
 */

import Link from "next/link";
import { TopBar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmailLink } from "@/components/ui/email-link";
import { Plus } from "lucide-react";
import {
  CONTACT_TYPE_LABEL,
  CONTACT_TYPES,
  getContactTypeCounts,
  listContacts,
} from "@/lib/queries/contacts";
import { currentUserHasPermission } from "@/lib/permission-check";

export default async function ContactsPage({
  searchParams,
}: PageProps<"/contacts">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const type = typeof sp.type === "string" ? sp.type : undefined;

  const [rows, typeCounts, canCreate] = await Promise.all([
    listContacts({ search: q, type }),
    getContactTypeCounts(),
    currentUserHasPermission("contacts.create"),
  ]);

  const totalActive = Object.values(typeCounts).reduce((a, b) => a + b, 0);

  return (
    <>
      <TopBar
        title="Contacts"
        crumbs="Directory"
        actions={
          canCreate ? (
            <Button size="sm" render={<Link href="/contacts/new" />}>
              <Plus />
              New contact
            </Button>
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto p-3 sm:p-5 animate-page-enter flex flex-col gap-4">
        {/* Search + filter pills */}
        <form className="flex items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search name, email, organization…"
            className="h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink w-72 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
          />
          {type && <input type="hidden" name="type" value={type} />}
          <Button type="submit" size="sm" variant="outline">
            Search
          </Button>
          {(q || type) && (
            <Link
              href="/contacts"
              className="text-2xs text-ink-4 hover:text-ink px-2"
            >
              Clear
            </Link>
          )}
        </form>

        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterPill
            label="All"
            count={totalActive}
            href={q ? `/contacts?q=${encodeURIComponent(q)}` : "/contacts"}
            active={!type}
          />
          {CONTACT_TYPES.map((t) => {
            const count = typeCounts[t] ?? 0;
            if (count === 0) return null;
            const params = new URLSearchParams();
            if (q) params.set("q", q);
            params.set("type", t);
            return (
              <FilterPill
                key={t}
                label={CONTACT_TYPE_LABEL[t]}
                count={count}
                href={`/contacts?${params.toString()}`}
                active={type === t}
              />
            );
          })}
        </div>

        {rows.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="text-sm font-semibold text-ink mb-1">
              No contacts match.
            </div>
            <div className="text-xs text-ink-3">
              {q || type
                ? "Try clearing filters or searching for something else."
                : "Add your first contact to start building the firm directory."}
            </div>
          </Card>
        ) : (
          <>
          {/* Mobile: card stack. The 6-col contacts table can't
              fit on a phone — collapse to one card per contact
              with name + type + organization + email/phone +
              matter count. Tablet+ keeps the table. */}
          <ul className="md:hidden flex flex-col gap-2">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/contacts/${c.id}`}
                  className="block rounded border border-line bg-card p-3 hover:border-brand-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-ink truncate">
                          {c.name}
                        </span>
                        {c.conflictStatus === "flagged" && (
                          <span className="text-2xs font-medium text-warn">
                            conflict
                          </span>
                        )}
                      </div>
                      <div className="text-2xs text-ink-3 mt-0.5">
                        {CONTACT_TYPE_LABEL[
                          c.type as keyof typeof CONTACT_TYPE_LABEL
                        ] ?? c.type}
                        {c.organization ? ` · ${c.organization}` : ""}
                      </div>
                      {(c.email || c.phone) && (
                        <div className="text-2xs font-mono text-ink-3 mt-1 truncate">
                          {c.email ?? c.phone}
                        </div>
                      )}
                    </div>
                    {c.matterCount > 0 && (
                      <span className="font-mono text-xs text-ink-3 shrink-0">
                        {c.matterCount}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <Card className="p-0 overflow-hidden hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="pr-4 text-right">Matters</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="pl-4">
                      <Link
                        href={`/contacts/${c.id}`}
                        className="text-xs font-medium text-ink hover:text-brand-700"
                      >
                        {c.name}
                      </Link>
                      {c.conflictStatus === "flagged" && (
                        <span className="ml-2 text-2xs font-medium text-warn">
                          conflict
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-2xs text-ink-3">
                      {CONTACT_TYPE_LABEL[
                        c.type as keyof typeof CONTACT_TYPE_LABEL
                      ] ?? c.type}
                    </TableCell>
                    <TableCell className="text-xs text-ink-3">
                      {c.organization ?? "—"}
                    </TableCell>
                    <TableCell className="text-2xs font-mono">
                      {c.email ? (
                        <EmailLink email={c.email} />
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-2xs font-mono text-ink-3">
                      {c.phone ?? "—"}
                    </TableCell>
                    <TableCell className="pr-4 text-right text-xs font-mono text-ink-3">
                      {c.matterCount > 0 ? c.matterCount : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          </>
        )}
      </div>
    </>
  );
}

function FilterPill({
  label,
  count,
  href,
  active,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "inline-flex items-center gap-1.5 text-2xs px-2.5 h-7 rounded-full border transition-colors " +
        (active
          ? "bg-brand-500 text-white border-brand-500"
          : "bg-white text-ink-3 border-line hover:border-brand-300 hover:text-brand-700")
      }
    >
      {label}
      <span
        className={
          "font-mono " +
          (active ? "text-white/80" : "text-ink-4")
        }
      >
        {count}
      </span>
    </Link>
  );
}
