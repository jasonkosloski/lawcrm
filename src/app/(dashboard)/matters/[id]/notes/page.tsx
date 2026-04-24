/**
 * Matter Detail — Notes tab
 *
 * Strategy memos, research notes, and internal chatter for this matter.
 * Pinned notes float to the top; everything else is sorted by most
 * recently updated.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Pin } from "lucide-react";
import { getMatterNotes } from "@/lib/queries/matter-detail";

const TYPE_LABEL: Record<string, string> = {
  note: "Note",
  strategy: "Strategy",
  chatter: "Chatter",
  memo: "Memo",
};

const formatDateTime = (d: Date): string =>
  d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default async function MatterNotesPage({
  params,
}: PageProps<"/matters/[id]">) {
  const { id } = await params;
  const notes = await getMatterNotes(id);

  if (notes.length === 0) {
    return (
      <div className="p-5">
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-sm font-semibold text-ink mb-1">
              No notes yet
            </div>
            <div className="text-xs text-ink-3">
              Strategy memos, research notes, and internal chatter for this
              matter will appear here.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      {notes.map((n) => (
        <Card key={n.id} className={n.isPinned ? "border-brand-200" : ""}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <span
                className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100 shrink-0"
                title={n.authorName}
              >
                {n.authorInitials}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-ink">
                  {n.authorName}
                </div>
                <div className="text-2xs text-ink-4">
                  {formatDateTime(n.updatedAt)}
                </div>
              </div>
              <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-brand-soft text-brand-700 border-brand-200">
                {TYPE_LABEL[n.type] ?? n.type}
              </span>
              {n.isPinned && (
                <span
                  className="inline-flex items-center gap-1 text-2xs text-brand-700"
                  title="Pinned"
                >
                  <Pin size={10} className="fill-brand-500 text-brand-500" />
                  Pinned
                </span>
              )}
            </div>
            <div className="text-xs text-ink leading-relaxed whitespace-pre-wrap">
              {n.content}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
