import "server-only";

/**
 * Minimal HTTP helpers shared by the gateway clients (plain `fetch`, no SDKs).
 */

/** An error returned by (or while reaching) a payment gateway. Its message is safe to show to an administrator. */
export class GatewayError extends Error {
  readonly gateway: string;
  readonly status: number;
  readonly code: string | undefined;

  constructor(gateway: string, message: string, status = 0, code?: string) {
    super(message);
    this.name = "GatewayError";
    this.gateway = gateway;
    this.status = status;
    this.code = code;
  }

  /** Network failure, timeout, rate limit or a 5xx: worth retrying later. */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** Default network timeout for gateway API calls. */
export const GATEWAY_TIMEOUT_MS = 20_000;

export interface GatewayRequestOptions {
  /** Abort the request after this many milliseconds (default 20s). */
  timeoutMs?: number;
}

/**
 * Flatten a nested object into Stripe-style form fields:
 * `{ a: { b: [ { c: 1 } ] } }` → `a[b][0][c]=1`. Undefined/null values are skipped.
 */
export function toFormBody(data: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  const walk = (prefix: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(prefix ? `${prefix}[${k}]` : k, v);
      return;
    }
    params.append(prefix, String(value));
  };
  walk("", data);
  return params;
}

/** `fetch` with a timeout. Network failures become a GatewayError (the URL and credentials are never included). */
export async function gatewayFetch(gateway: string, url: string, init: RequestInit, timeoutMs = GATEWAY_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    const reason = name === "TimeoutError" || name === "AbortError" ? "did not respond in time" : "could not be reached";
    throw new GatewayError(gateway, `${gateway} ${reason}. Please try again in a moment.`);
  }
}

/** Read a JSON response body, tolerating empty or invalid bodies. */
export async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Parse a JSON document received from a gateway (webhook bodies). Returns null when it is not a JSON object. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Safe string accessor for untyped gateway payloads. */
export function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Safe number accessor for untyped gateway payloads. */
export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Safe object accessor for untyped gateway payloads. */
export function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** String-valued entries of a metadata/notes object. */
export function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(value))) if (typeof v === "string") out[k] = v;
  return out;
}
