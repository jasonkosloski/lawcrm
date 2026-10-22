/**
 * Court formats list for /settings/court-formats: grouped by court
 * system, with venue counts and archive / restore / delete controls that
 * each render only with their permission. A refused delete (venues still
 * use the format) shows the server's message inline.
 */

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Plus, Trash2 } from "lucide-react";
import { deleteCourtFormat, setCourtFormatActive } from "@/app/actions/court-formats";
import { Card, CardContent } from "@/components/ui/card";
import type { CourtSystem } from "@/lib/templates/page-style";

export type CourtFormatListRow = {
  id: string;
  name: string;
  courtSystem: CourtSystem;
  isActive: boolean;
  venueCount: number;
};

const GROUPS: { system: CourtSystem; label: string }[] = [
  { system: "state", label: "State" },
  { system: "federal", label: "Federal" },
  { system: "other", label: "Other" },
];

const iconBtn =
  "inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:text-brand-700 hover:bg-brand-soft disabled:opacity-60";

export function CourtFormatList({
  formats,
  canAdd,
  canEdit,
  canDelete,
}: {
  formats: CourtFormatListRow[];
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) setError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {canAdd && (
        <div className="flex justify-end">
          <Link
            href="/settings/court-formats/new"
            className="inline-flex h-8 items-center gap-1 rounded-md bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-700"
          >
            <Plus size={14} /> New court format
          </Link>
        </div>
      )}
      {error && (
        <div role="alert" className="text-2xs text-warn">
          {error}
        </div>
      )}
      {formats.length === 0 ? (
        <Card>
          <CardContent className="px-4 py-6 text-xs text-ink-4">No court formats yet.</CardContent>
        </Card>
      ) : (
        GROUPS.map(({ system, label }) => {
          const rows = formats.filter((f) => f.courtSystem === system);
          if (rows.length === 0) return null;
          return (
            <section key={system} className="flex flex-col gap-1">
              <h2 className="text-xs font-semibold text-ink-2">{label}</h2>
              <ul className="divide-y divide-line rounded-md border border-line bg-white">
                {rows.map((f) => (
                  <li
                    key={f.id}
                    className={`flex items-center gap-3 px-3 py-2 ${f.isActive ? "" : "opacity-60"}`}
                  >
                    <Link
                      href={`/settings/court-formats/${f.id}`}
                      className="flex-1 text-xs font-medium text-ink hover:underline"
                    >
                      {f.name}
                    </Link>
                    {!f.isActive && <span className="text-2xs text-ink-4">Archived</span>}
                    <span className="text-2xs text-ink-3">
                      {f.venueCount} {f.venueCount === 1 ? "venue" : "venues"}
                    </span>
                    <div className="flex items-center gap-0.5">
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`${f.isActive ? "Archive" : "Restore"} ${f.name}`}
                          title={f.isActive ? "Archive" : "Restore"}
                          disabled={pending}
                          onClick={() => run(() => setCourtFormatActive(f.id, !f.isActive))}
                          className={iconBtn}
                        >
                          {f.isActive ? <Archive size={13} /> : <ArchiveRestore size={13} />}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          aria-label={`Delete ${f.name}`}
                          title="Delete"
                          disabled={pending}
                          onClick={() => run(() => deleteCourtFormat(f.id))}
                          className={iconBtn}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
