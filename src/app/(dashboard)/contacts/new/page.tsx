/**
 * New Contact page.
 */

import { TopBar } from "@/components/layout/topbar";
import { ContactForm } from "@/components/contacts/contact-form";
import { createContact } from "@/app/actions/contacts";

export default function NewContactPage() {
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
