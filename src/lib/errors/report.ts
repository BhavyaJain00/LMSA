/**
 * Browser side of the error log: error boundaries call `reportClientError`
 * once per error. Sends only the message, stack, digest and current path
 * (no query string) to `/api/errors`; failures are ignored.
 */

const reported = new Set<string>();

export function reportClientError(error: Error & { digest?: string }): void {
  if (typeof window === "undefined") return;
  const key = `${error.digest ?? ""}|${error.message ?? ""}`;
  if (reported.has(key)) return;
  reported.add(key);
  const body = JSON.stringify({
    message: String(error.message ?? "").slice(0, 1000),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 8000) : undefined,
    digest: error.digest,
    path: window.location.pathname,
  });
  try {
    void fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* reporting must never throw */
  }
}
