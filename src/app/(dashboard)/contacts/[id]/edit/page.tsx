/**
 * Edit Contact page.
 *
 * Page-guarded on contacts.edit (the updateContact action re-checks
 * server-side). Conflict status is NOT edited here — it goes through
 * the detail page's justified control so changes hit the audit log.
 * Merged-away contacts bounce to the surviving record.
 */

import { notFound, redirect } from "next/navigation";
import { TopBar } from "@/components/layout/topbar";
import { ContactForm } from "@/components/contacts/contact-form";
import { updateContact } from "@/app/actions/contacts";
import { getContactById } from "@/lib/queries/contacts";
import { currentUserHasPermission } from "@/lib/permission-check";

export default async function EditContactPage({
  params,
}: PageProps<"/contacts/[id]/edit">) {
  const { id } = await params;
  const [c, canEdit] = await Promise.all([
    getContactById(id),
    currentUserHasPermission("contacts.edit"),
  ]);
  if (!c) notFound();
  if (c.mergedIntoId) redirect(`/contacts/${c.mergedIntoId}`);
  if (!canEdit) redirect(`/contacts/${id}`);

  const boundUpdate = updateContact.bind(null, id);

  return (
    <>
      <TopBar
        title="Edit contact"
        crumbs={`Contacts / ${c.name} / Edit`}
      />
      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <ContactForm
          action={boundUpdate}
          submitLabel="Save changes"
          backHref={`/contacts/${id}`}
          redirectsOnSuccess={false}
          initial={{
            name: c.name,
            type: c.type,
            email: c.email ?? "",
            phone: c.phone ?? "",
            organization: c.organization ?? "",
            address: c.address ?? "",
            city: c.city ?? "",
            state: c.state ?? "",
            zip: c.zip ?? "",
            notes: c.notes ?? "",
          }}
        />
      </div>
    </>
  );
}
