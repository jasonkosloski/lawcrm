/**
 * Inline PDF renderer — a full-height iframe on the download URL.
 * The download route serves application/pdf with
 * `Content-Disposition: inline`, so browsers with a built-in PDF
 * viewer (all modern desktop browsers) render it in place.
 *
 * iframes have no fallback content, so a link line rides below the
 * frame for environments that download instead of render (some
 * mobile browsers, PDF viewing disabled). Server-renderable.
 */

export function PdfViewer({ src, name }: { src: string; name: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-2">
      <iframe
        src={src}
        title={name}
        className="min-h-0 w-full flex-1 rounded-lg border border-line bg-paper-2"
      />
      <div className="text-2xs text-ink-4">
        PDF not displaying?{" "}
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-brand-700"
        >
          Open in a new tab
        </a>{" "}
        or{" "}
        <a
          href={src}
          download={name}
          className="underline hover:text-brand-700"
        >
          download it
        </a>
        .
      </div>
    </div>
  );
}
