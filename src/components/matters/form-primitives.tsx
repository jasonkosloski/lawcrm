/**
 * Layout primitives shared by NewMatterForm and EditMatterForm.
 * Field chrome lives in `@/components/ui/field`.
 */

import { type ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-2xs font-medium text-ink-3">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}
