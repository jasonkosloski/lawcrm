/**
 * Editor page header: back link, title, actions slot and, for a saved
 * block, which templates and court formats use it.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/utils";

/** Both save actions' stale-version refusal starts with this. */
const STALE_PREFIX = "Someone else saved this";

export type Usage = { id: string; name: string; kind?: "template" | "court_format" };

export function EditorHeader({
  isBlock,
  title,
  usage,
  children,
}: {
  isBlock: boolean;
  title: string;
  /** Saved blocks only. */
  usage?: Usage[];
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Link
        href={isBlock ? "/settings/templates?tab=blocks" : "/settings/templates"}
        className="inline-flex w-fit items-center gap-1 text-xs text-ink-3 hover:text-brand-700"
      >
        <ArrowLeft size={12} />
        {isBlock ? "All blocks" : "All templates"}
      </Link>
      <div className="flex items-center gap-3">
        <h1 className="truncate text-lg font-semibold text-ink">{title}</h1>
        {children}
      </div>
      {usage && <UsageLine usage={usage} />}
    </div>
  );
}

function UsageLine({ usage }: { usage: Usage[] }) {
  if (usage.length === 0) {
    return <p className="text-xs text-ink-4">Not used by any template or court format yet.</p>;
  }
  const formats = usage.filter((u) => u.kind === "court_format").length;
  const templates = usage.length - formats;
  const label = [
    templates > 0 ? plural(templates, "template") : null,
    formats > 0 ? plural(formats, "court format") : null,
  ]
    .filter(Boolean)
    .join(" and ");
  return (
    <p className="text-xs text-ink-3">
      <span>{`Used by ${label}`}</span>
      {": "}
      {usage.map((u, i) => (
        <span key={u.id}>
          {i > 0 && ", "}
          <Link
            href={
              u.kind === "court_format"
                ? `/settings/court-formats/${u.id}`
                : `/settings/templates/${u.id}`
            }
            className="text-brand-700 hover:underline"
          >
            {u.name}
          </Link>
        </span>
      ))}
    </p>
  );
}

/** A failed save; a stale-version refusal also offers Reload. */
export function SaveErrorBanner({ error, onReload }: { error: string; onReload: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
      <span>{error}</span>
      {error.startsWith(STALE_PREFIX) && (
        <Button variant="outline" size="xs" onClick={onReload}>
          Reload
        </Button>
      )}
    </div>
  );
}
