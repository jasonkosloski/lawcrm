/**
 * Word (.docx) preview body — renders HTML that was converted by
 * mammoth AND sanitized through `sanitizeDocumentHtml`
 * (`src/lib/document-preview.ts`) before it reaches this component.
 * Never hand this component unsanitized markup.
 *
 * The paper container mimics a printed page (max-width, white sheet,
 * generous padding); element styling is applied via arbitrary
 * variants since the injected HTML can't carry classes of its own
 * (the sanitizer only preserves `class`, and mammoth doesn't emit
 * Tailwind ones). Server-renderable.
 */

const PAPER_TYPOGRAPHY = [
  "[&_p]:my-2",
  "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold",
  "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:font-semibold",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_li]:my-0.5",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-3",
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse",
  "[&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_td]:align-top",
  "[&_th]:border [&_th]:border-line [&_th]:bg-paper-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold",
  "[&_hr]:my-4 [&_hr]:border-line",
  "[&_img]:my-2 [&_img]:max-w-full",
  "[&_a]:text-brand-700 [&_a]:underline",
  "[&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-paper-2 [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-xs",
].join(" ");

export function DocxViewer({ safeHtml }: { safeHtml: string }) {
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-paper-2 p-4 sm:p-8">
      <div
        className={`mx-auto min-h-full max-w-3xl rounded-sm border border-line bg-white px-8 py-10 text-sm leading-relaxed text-ink shadow-sm sm:px-14 sm:py-14 ${PAPER_TYPOGRAPHY}`}
        // Sanitized server-side via sanitizeDocumentHtml before it
        // is passed in — see the docx pipeline in
        // src/lib/document-preview.ts.
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </div>
  );
}
