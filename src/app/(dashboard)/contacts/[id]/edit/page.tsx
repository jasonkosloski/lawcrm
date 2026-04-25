/**
 * Edit Contact page.
 */

import { notFound } from "next/navigation";
import { TopBar } from "@/components/layout/topbar";
import { ContactForm } from "@/components/contacts/contact-form";
import { updateContact } from "@/app/actions/contacts";
import { getContactById } from "@/lib/queries/contacts";

export default async function EditContactPage({
  params,
}: PageProps<"/contacts/[id]/edit">) {
  const { id } = await params;
  const c = await getContactById(id);
  if (!c) notFound();

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
            conflictStatus: c.conflictStatus,
          }}
        />
      </div>
    </>
  );
}
