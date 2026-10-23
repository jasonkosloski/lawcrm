/**
 * Lazy Rich Text Editor — `RichTextEditor` behind `next/dynamic`, so
 * Tiptap + ProseMirror (the heaviest client dependency we ship) load
 * only when a composer actually renders, not with every page that
 * imports one. Client-only (`ssr: false`): the editor already
 * initializes after mount (`immediatelyRender: false`), so nothing is
 * lost on the server render.
 *
 * Use this from consumers; import `@/components/shared/rich-text-editor` directly only
 * in its own tests (extensions live in `@/components/editor/presets`).
 */

"use client";

import dynamic from "next/dynamic";

export const RichTextEditor = dynamic(
  () => import("@/components/shared/rich-text-editor").then((m) => m.RichTextEditor),
  {
    ssr: false,
    // Same box the editor itself shows before Tiptap has mounted.
    loading: () => (
      <div className="border border-line rounded-md bg-white min-h-[120px] px-3 py-2 text-xs text-ink-4">
        Loading editor…
      </div>
    ),
  },
);
