/**
 * New Contact page.
 *
 * Page-guarded on contacts.create (the createContact action
 * re-checks server-side).
 */

import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/topbar";
import { ContactForm } from "@/components/contacts/contact-form";
import { createContact } from "@/app/actions/contacts";
import { currentUserHasPermission } from "@/lib/permission-check";

export default async function NewContactPage() {
  const canCreate = await currentUserHasPermission("contacts.create");
  if (!canCreate) redirect("/contacts");

  return (
    <>
      <TopBar title="New contact" crumbs="Contacts / New" />
      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <ContactForm
          action={createContact}
          submitLabel="Create contact"
          backHref="/contacts"
          redirectsOnSuccess
        />
      </div>
    </>
  );
}
