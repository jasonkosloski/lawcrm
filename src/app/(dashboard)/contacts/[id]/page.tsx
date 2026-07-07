/**
 * Contact detail page.
 *
 * Profile + full phone list + linked matters (where this contact is
 * the client, and where they appear as a non-client party). Edit /
 * delete / merge / log-call actions live in the topbar, each behind
 * its permission key. Contacts that were merged away redirect to the
 * surviving record via `mergedIntoId`.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pencil } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmailLink } from "@/components/ui/email-link";
import { ContactDeleteButton } from "@/components/contacts/contact-delete-button";
import { ContactMergeMenu } from "@/components/contacts/contact-merge-menu";
import { ContactPhonesCard } from "@/components/contacts/contact-phones-card";
import { ConflictStatusControl } from "@/components/contacts/conflict-status-control";
import { LogCallButton } from "@/components/communication/log-call-button";
import { CONTACT_TYPE_LABEL } from "@/lib/contact-constants";
import {
  getContactById,
  listContactPickerOptions,
} from "@/lib/queries/contacts";
import { getFilingMatterOptions } from "@/lib/queries/communication";
import { currentUserHasPermission } from "@/lib/permission-check";

const PARTY_CATEGORY_LABEL: Record<string, string> = {
  client: "Client",
  opposing: "Opposing",
  lay_witness: "Witness",
  expert_witness: "Expert",
  other: "Other",
};

const CONFLICT_LABEL: Record<string, string> = {
  clear: "Clear",
  flagged: "Flagged",
  override: "Override",
};

export default async function ContactDetailPage({
  params,
}: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  const c = await getContactById(id);
  if (!c) notFound();
  // Merged-away records keep their row for audit but the page always
  // lands on the survivor.
  if (c.mergedIntoId) redirect(`/contacts/${c.mergedIntoId}`);

  const [canEdit, canDelete, canMerge, canLogCall] = await Promise.all([
    currentUserHasPermission("contacts.edit"),
    currentUserHasPermission("contacts.delete"),
    currentUserHasPermission("contacts.merge"),
    currentUserHasPermission("communication.log_call"),
  ]);

  // One picker fetch feeds both the merge dialog and the log-call
  // composer; skip it entirely when neither is visible.
  const [pickerOptions, callMatters] = await Promise.all([
    canMerge || canLogCall
      ? listContactPickerOptions()
      : Promise.resolve([]),
    canLogCall ? getFilingMatterOptions() : Promise.resolve([]),
  ]);

  const typeLabel =
    CONTACT_TYPE_LABEL[c.type as keyof typeof CONTACT_TYPE_LABEL] ?? c.type;
  const fullAddress = [c.address, c.city, c.state, c.zip]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <TopBar
        title={c.name}
        crumbs={`Contacts / ${typeLabel}`}
        subtitle={
          c.conflictStatus === "flagged" ? (
            <span className="text-2xs font-medium px-2 py-0.5 rounded-full bg-warn-soft text-warn border border-warn-border">
              Conflict
            </span>
          ) : c.conflictStatus === "override" ? (
            <span className="text-2xs font-medium px-2 py-0.5 rounded-full bg-brand-soft text-brand-700 border border-brand-200">
              Override
            </span>
          ) : null
        }
        actions={
          <>
            {canLogCall && (
              <LogCallButton
                contacts={pickerOptions}
                matters={callMatters.map((m) => ({
                  id: m.id,
                  name: m.name,
                }))}
                fixedContact={{
                  id: c.id,
                  name: c.name,
                  organization: c.organization,
                  phone: c.phone,
                }}
              />
            )}
            {canDelete && (
              <ContactDeleteButton contactId={c.id} contactName={c.name} />
            )}
            {canEdit && (
              <Button
                size="sm"
                render={<Link href={`/contacts/${c.id}/edit`} />}
              >
                <Pencil />
                Edit
              </Button>
            )}
            {canMerge && (
              <ContactMergeMenu
                contactId={c.id}
                contactName={c.name}
                candidates={pickerOptions.filter((o) => o.id !== c.id)}
              />
            )}
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-3 sm:p-5 animate-page-enter">
        <div className="max-w-3xl flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Profile</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 text-xs">
                <Field label="Type" value={typeLabel} />
                <Field label="Organization" value={c.organization ?? "—"} />
                <Field
                  label="Email"
                  value={
                    c.email ? <EmailLink email={c.email} /> : <span>—</span>
                  }
                />
                <Field label="Phone" value={c.phone ?? "—"} />
                <Field
                  label="Conflict check"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={
                          c.conflictStatus === "flagged"
                            ? "text-warn font-medium"
                            : c.conflictStatus === "override"
                              ? "text-brand-700 font-medium"
                              : "text-ink"
                        }
                      >
                        {CONFLICT_LABEL[c.conflictStatus] ?? c.conflictStatus}
                      </span>
                      {canEdit && (
                        <ConflictStatusControl
                          contactId={c.id}
                          currentStatus={c.conflictStatus}
                        />
                      )}
                    </span>
                  }
                />
                {fullAddress && (
                  <div className="col-span-2 pt-2 border-t border-line">
                    <dt className="text-ink-4 mb-0.5">Address</dt>
                    <dd className="text-ink">{fullAddress}</dd>
                  </div>
                )}
                {c.notes && (
                  <div className="col-span-2 pt-2 border-t border-line">
                    <dt className="text-ink-4 mb-0.5">Notes</dt>
                    <dd className="text-ink leading-relaxed whitespace-pre-wrap">
                      {c.notes}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <ContactPhonesCard
            contactId={c.id}
            phones={c.phones}
            canEdit={canEdit}
          />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                Matters
                <span className="text-2xs font-mono font-normal text-ink-4">
                  {c.asClientMatters.length + c.asPartyMatters.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {c.asClientMatters.length === 0 &&
              c.asPartyMatters.length === 0 ? (
                <div className="py-3 text-xs text-ink-4">
                  Not linked to any matter yet.
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {c.asClientMatters.map((m) => (
                    <Link
                      key={`client-${m.id}`}
                      href={`/matters/${m.id}`}
                      className="flex items-center gap-3 py-2 border-b border-line last:border-b-0 hover:bg-paper-2 -mx-2 px-2 rounded-sm transition-colors"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: m.color }}
                      />
                      <span className="flex-1 text-xs text-ink truncate">
                        {m.name}
                      </span>
                      <span className="text-2xs text-ink-4 font-mono shrink-0">
                        client
                      </span>
                      <span className="text-2xs text-ink-4 font-mono shrink-0">
                        {m.area} · {m.stage}
                      </span>
                    </Link>
                  ))}
                  {c.asPartyMatters.map((mc) => (
                    <Link
                      key={`party-${mc.id}`}
                      href={`/matters/${mc.matterId}`}
                      className="flex items-center gap-3 py-2 border-b border-line last:border-b-0 hover:bg-paper-2 -mx-2 px-2 rounded-sm transition-colors"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: mc.matterColor }}
                      />
                      <span className="flex-1 text-xs text-ink truncate">
                        {mc.matterName}
                      </span>
                      <span className="text-2xs text-ink-4 font-mono shrink-0">
                        {PARTY_CATEGORY_LABEL[mc.category] ?? mc.category}
                        {mc.role ? ` · ${mc.role}` : ""}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-ink-4 mb-0.5">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
