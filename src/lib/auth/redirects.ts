/**
 * Safe same-origin redirect targets for user-supplied return paths (`next`).
 *
 * Browsers and Next's client router resolve URLs with the WHATWG parser,
 * which strips ASCII tab/CR/LF anywhere in the string and treats `\` like `/`
 * in http(s) URLs. So `/\evil.example` or `/<TAB>/evil.example` pass a naive
 * "starts with / but not //" check and still leave the site. This helper:
 *
 *  1. accepts only strings of at most 2048 characters,
 *  2. rejects any control character (U+0000–U+001F, U+007F) and any backslash,
 *  3. requires a root-relative path: `/` not followed by `/`,
 *  4. resolves it against a fixed placeholder origin and requires the result
 *     to stay on that origin,
 *  5. returns the normalised `pathname + search + hash` — and rejects it if
 *     normalisation produced a protocol-relative path (`/..//evil.example`
 *     resolves to the path `//evil.example`).
 *
 * Pure and isomorphic (only the global `URL`), so pages, Server Actions and
 * client components share one definition.
 */

const PLACEHOLDER_ORIGIN = "http://local.invalid";
const MAX_LENGTH = 2048;
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;

/** The normalised same-origin path for `input`, or `fallback` (null by default) when it isn't one. */
export function safeRedirectPath(input: unknown): string | null;
export function safeRedirectPath<F>(input: unknown, fallback: F): string | F;
export function safeRedirectPath(input: unknown, ...rest: [unknown?]): unknown {
  // An explicitly passed `undefined` fallback is kept (pages use it for optional props).
  const fallback = rest.length > 0 ? rest[0] : null;
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_LENGTH) return fallback;
  if (CONTROL_OR_BACKSLASH.test(input)) return fallback;
  if (input[0] !== "/" || input[1] === "/") return fallback;
  let url: URL;
  try {
    url = new URL(input, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!path.startsWith("/") || path.startsWith("//") || CONTROL_OR_BACKSLASH.test(path)) return fallback;
  return path;
}
