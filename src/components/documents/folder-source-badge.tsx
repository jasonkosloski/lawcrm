/**
 * FolderSourceBadge — small chip on a system-generated folder linking
 * back to the records request (or the records list) that owns it.
 * Renders nothing for an ordinary folder. See ADR-048.
 */

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import type { RecordScope } from "@/lib/record-scope";
import { folderSourceLink } from "@/lib/records-requests/folder-kinds";

export function FolderSourceBadge({
  folder,
  scope,
}: {
  folder: {
    systemKind: string | null;
    recordsRequestId: string | null;
    sourceTitle?: string | null;
  };
  scope: RecordScope;
}) {
  const link = folderSourceLink(folder, scope);
  if (!link) return null;
  return (
    <Link
      href={link.href}
      title={folder.sourceTitle ?? undefined}
      className="inline-flex items-center gap-1 rounded-full border border-line bg-paper-2 px-1.5 py-0.5 text-2xs font-normal text-ink-3 hover:text-brand-700"
    >
      <ClipboardList size={10} aria-hidden />
      {link.label}
    </Link>
  );
}
