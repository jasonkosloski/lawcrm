/**
 * Client-safe signature helpers for the composers (the lookup in
 * `email-signature.ts` is server-only).
 */

import { htmlToText } from "@/lib/html-to-text";

/** True when the body holds nothing the user wrote: empty, or just the
 *  signature it was seeded with. Gates Send so a signature-only email
 *  can't go out by accident. */
export function isBodyEmpty(body: string, signature: string | null): boolean {
  const text = htmlToText(body).trim();
  return text === "" || (!!signature && text === htmlToText(signature).trim());
}
