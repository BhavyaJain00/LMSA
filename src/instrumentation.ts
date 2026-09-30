import type { Instrumentation } from "next";

/**
 * Server start-up and error hooks.
 *
 * - `register()` checks the deployment configuration once per server start
 *   (warnings in development; missing required settings stop a production
 *   server). Skipped during `next build`.
 * - `onRequestError()` records failed renders, route handlers and Server
 *   Actions in the admin error log (grouped by message and route). Only the
 *   path, method and the session cookie (to link the member) are read; no
 *   request bodies, query strings or other headers are stored.
 *
 * Both only run in the Node.js runtime; the store and file system are not
 * available on the edge.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runStartupChecks } = await import("@/lib/env-check");
  runStartupChecks();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { recordRequestError } = await import("@/lib/errors/record");
    await recordRequestError(error, { path: request.path, method: request.method, headers: request.headers }, { routePath: context.routePath, routeType: context.routeType });
  } catch (err) {
    console.error("[errors] onRequestError failed", err instanceof Error ? err.message : err);
  }
};
