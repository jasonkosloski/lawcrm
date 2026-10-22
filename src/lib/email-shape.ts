/**
 * The one email shape check for addresses people type in (contacts,
 * parties, attendees, new clients, portal invites). Lenient on
 * purpose: something@something.tld with no whitespace. Not a
 * deliverability test - it only catches typos like "dana@" or
 * "dana example.com". Safe on the client and the server.
 *
 * Callers only apply it to values being written; stored records are
 * never re-validated with it.
 */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isLenientEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}
