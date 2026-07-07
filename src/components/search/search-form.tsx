/**
 * Global search input.
 *
 * A plain GET form via `next/form` — submitting navigates to
 * /search?q=<value> with client-side navigation, no JS state. A new
 * query deliberately drops any ?type= expansion (a fresh search
 * should show all groups again).
 */

import Form from "next/form";
import { Search } from "lucide-react";

export function SearchForm({ initialQuery }: { initialQuery: string }) {
  return (
    <Form action="/search" className="relative">
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none"
      />
      <input
        // Re-key on the URL's query so client-side navigation (e.g.
        // arriving from the ⌘K palette while this page is mounted)
        // resets the uncontrolled input to the active query.
        key={initialQuery}
        type="search"
        name="q"
        defaultValue={initialQuery}
        placeholder="Search matters, contacts, notes, documents, email, messages…"
        autoFocus
        aria-label="Search everywhere"
        className="w-full h-10 pl-9 pr-3 rounded-md border border-line-2 bg-white text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-brand-300 transition-colors"
      />
    </Form>
  );
}
