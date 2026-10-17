/**
 * The email filter the Communication page falls back to when
 * `?filter=` is absent. Single source for the page's parser, the
 * mailbox rail's links and the thread rows' links: they must agree,
 * or opening a thread silently resets the list (F195).
 * Kept free of server-only imports so any component can use it.
 */
export const DEFAULT_COMMUNICATION_FILTER = "inbox" as const;
