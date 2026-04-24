/**
 * Matter Create — placeholder for any create type
 *
 * `/matters/<id>/new/<type>` where `<type>` is one of the keys in
 * `MATTER_CREATE_ENTRIES`. Shows the expected form fields so whoever
 * picks up the real build has a spec. When a real form ships, replace
 * this with a typed dispatch per type, or split into dedicated routes.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMatterById } from "@/lib/queries/matters";
import { findMatterCreateEntry } from "@/lib/matter-create-types";

export default async function MatterCreatePage({
  params,
}: PageProps<"/matters/[id]/new/[type]">) {
  const { id, type } = await params;
  const entry = findMatterCreateEntry(type);
  if (!entry) notFound();

  const matter = await getMatterById(id);
  if (!matter) notFound();

  return (
    <div className="p-5">
      <Link
        href={`/matters/${id}`}
        className="text-2xs text-ink-3 hover:text-brand-700"
      >
        ← {matter.name}
      </Link>
      <h1 className="text-lg font-display font-medium text-ink mt-2 mb-1">
        {entry.label}
      </h1>
      <p className="text-sm text-ink-3 mb-5 max-w-2xl">{entry.description}</p>

      <Card className="max-w-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Form fields coming
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <ul className="flex flex-col gap-1.5 text-xs text-ink-2 list-disc pl-4">
            {entry.expected.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="mt-4 pt-3 border-t border-line text-2xs text-ink-4">
            The real create form for this type is a Phase 2.X follow-up.
            See <code className="font-mono text-ink-3">docs/FEATURES.md</code>
            {" "}for the full scope of each matter-detail tab.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
