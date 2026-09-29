/**
 * Minimal fake of `next/navigation` for tests. Like the real functions,
 * `redirect()`, `notFound()`, `forbidden()` and `unauthorized()` never return:
 * they throw an error whose `digest` follows Next.js' format, so tests can
 * assert where a Server Action or page would have sent the user
 * (see `redirectTarget` in `tests/helpers/request.ts`).
 */

export const RedirectType = { push: "push", replace: "replace" };

function navigationError(message, digest, extra = {}) {
  const error = new Error(message);
  error.digest = digest;
  Object.assign(error, extra);
  return error;
}

export function redirect(url, type = RedirectType.replace) {
  throw navigationError(`NEXT_REDIRECT ${url}`, `NEXT_REDIRECT;${type};${url};307;`, { url, status: 307 });
}

export function permanentRedirect(url, type = RedirectType.replace) {
  throw navigationError(`NEXT_REDIRECT ${url}`, `NEXT_REDIRECT;${type};${url};308;`, { url, status: 308 });
}

export function notFound() {
  throw navigationError("NEXT_HTTP_ERROR_FALLBACK;404", "NEXT_HTTP_ERROR_FALLBACK;404", { status: 404 });
}

export function forbidden() {
  throw navigationError("NEXT_HTTP_ERROR_FALLBACK;403", "NEXT_HTTP_ERROR_FALLBACK;403", { status: 403 });
}

export function unauthorized() {
  throw navigationError("NEXT_HTTP_ERROR_FALLBACK;401", "NEXT_HTTP_ERROR_FALLBACK;401", { status: 401 });
}

export function unstable_rethrow(error) {
  if (error && typeof error === "object" && typeof error.digest === "string" && /^NEXT_(REDIRECT|HTTP_ERROR_FALLBACK)/.test(error.digest)) throw error;
}
