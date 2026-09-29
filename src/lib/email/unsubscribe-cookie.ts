/**
 * Name of the short-lived receipt cookie set after a signed unsubscribe (or
 * its undo). It lets the confirmation at `/settings/notifications?confirmed=1`
 * — a URL without the signed token — work without a session; the proxy lets
 * that path through when the cookie is present, and the page re-verifies the
 * signature stored inside it. Pure module (imported by `src/proxy.ts`).
 */
export const UNSUBSCRIBE_RECEIPT_COOKIE = "ll_unsub";
