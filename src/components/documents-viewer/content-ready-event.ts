/**
 * DOM event contract between async viewer bodies and the evidence
 * review adapters.
 *
 * Server-rendered viewer bodies (mammoth sheet, text <pre>, CSV
 * table) have their text in the DOM at hydration, so TextReview's
 * `?flag=` deep link can relocate a quote immediately. The
 * client-side docx-preview renderer doesn't: it fetches bytes and
 * renders after mount. It announces "my text is now walkable" by
 * dispatching this bubbling event from its root; TextReview (with
 * `awaitContentReady`) defers the initial quote relocation until the
 * event arrives instead of failing against an empty container.
 *
 * A DOM event (not a callback prop) so the page can compose
 * `<TextReview><DocxPreviewRenderer/></TextReview>` from a server
 * component without threading client function props through RSC.
 */

export const VIEWER_CONTENT_READY_EVENT = "documents-viewer:content-ready";

/** Fired on BOTH outcomes — successful docx-preview render and the
 *  fallback swap — so a listener always gets exactly one signal. */
export function dispatchViewerContentReady(el: HTMLElement): void {
  el.dispatchEvent(new CustomEvent(VIEWER_CONTENT_READY_EVENT, { bubbles: true }));
}
