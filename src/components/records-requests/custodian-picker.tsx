/**
 * Custodian picker for a records request: search the firm's contacts
 * (the same search the attendee picker uses), or quick-create a medical
 * provider / government custodian without leaving the form. Emits the
 * chosen contact through a hidden `custodianContactId` input so it posts
 * with the surrounding form.
 */

"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, Search, X } from "lucide-react";
import { searchAttendeesAction } from "@/app/actions/attendee-search";
import { createCustodianContact } from "@/app/actions/records-requests";
import { cn } from "@/lib/utils";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

type Picked = { id: string; name: string };
type Hit = { id: string; name: string; sub: string | null };

const input = inputClass();

export function CustodianPicker({
  value,
  onChange,
  canCreateContact,
  error,
}: {
  value: Picked | null;
  onChange: (next: Picked | null) => void;
  /** `contacts.create`: hides quick-create without it. */
  canCreateContact: boolean;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("medical_provider");
  const [createError, setCreateError] = useState<string | null>(null);
  const [pending, startCreate] = useTransition();
  // Out-of-order responses: only the latest query may set the hits.
  const seq = useRef(0);

  const search = async (q: string) => {
    setQuery(q);
    const mine = ++seq.current;
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const res = await searchAttendeesAction(q, [], []);
    if (mine !== seq.current) return;
    setHits(
      res
        .filter((r) => r.kind === "contact")
        .map((r) => ({
          id: r.id,
          name: r.name,
          sub: r.kind === "contact" ? (r.organization ?? r.type) : null,
        }))
    );
  };

  const pick = (p: Picked) => {
    onChange(p);
    setQuery("");
    setHits([]);
    setCreating(false);
  };

  const create = () => {
    setCreateError(null);
    startCreate(async () => {
      const res = await createCustodianContact(newName, newType);
      if (res.ok) {
        pick({ id: res.id, name: res.name });
        setNewName("");
      } else {
        setCreateError(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xs font-medium text-ink-3">
        Custodian
      </span>
      <input type="hidden" name="custodianContactId" value={value?.id ?? ""} />
      {value ? (
        <div className="inline-flex items-center gap-2 h-8 px-2 rounded-md border border-line bg-paper-2/40 text-xs text-ink w-fit">
          <span className="font-medium">{value.name}</span>
          <button
            type="button"
            aria-label="Change custodian"
            onClick={() => onChange(null)}
            className="text-ink-4 hover:text-ink-2"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-4"
            />
            <input
              type="text"
              aria-label="Search custodians"
              placeholder="Search contacts…"
              value={query}
              onChange={(e) => void search(e.target.value)}
              className={cn(input, "w-full pl-7")}
            />
          </div>
          {hits.length > 0 && (
            <ul className="rounded-md border border-line bg-white divide-y divide-line max-h-44 overflow-y-auto">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => pick({ id: h.id, name: h.name })}
                    className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-brand-tint"
                  >
                    <span className="font-medium text-ink">{h.name}</span>
                    {h.sub && (
                      <span className="ml-2 text-2xs text-ink-4">{h.sub}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {canCreateContact && !creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1 text-2xs text-brand-700 hover:underline w-fit"
            >
              <Plus size={11} />
              New custodian
            </button>
          )}
          {canCreateContact && creating && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper-2/40 p-2">
              <input
                type="text"
                aria-label="New custodian name"
                placeholder="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className={cn(input, "flex-1 min-w-40")}
              />
              <NativeSelect
                aria-label="New custodian type"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
              >
                <NativeSelectOption value="medical_provider">Medical provider</NativeSelectOption>
                <NativeSelectOption value="government">Government</NativeSelectOption>
              </NativeSelect>
              <Button
                size="sm"
                type="button"
                disabled={pending || !newName.trim()}
                onClick={create}
              >
                {pending ? "Adding…" : "Add custodian"}
              </Button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="text-2xs text-ink-3 hover:text-ink"
              >
                Cancel
              </button>
              {createError && (
                <span className="basis-full text-2xs text-warn">
                  {createError}
                </span>
              )}
            </div>
          )}
        </>
      )}
      {error && <span className="text-2xs text-warn">{error}</span>}
    </div>
  );
}
