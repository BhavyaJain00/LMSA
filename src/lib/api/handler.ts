import "server-only";
import { after, NextResponse, type NextRequest } from "next/server";
import type { ApiKey, AuditEvent, Database } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { getDb } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { clientIpFromHeaders } from "@/lib/auth/request-info";
import { recordError } from "@/lib/errors/record";
import { uid } from "@/lib/utils";
import type { EndpointDef } from "./endpoints";
import { ApiError, validationError } from "./errors";
import { authenticateApiKey, shouldTouchKey, touchApiKey } from "./auth";
import { linkHeader, normalizeListQuery, type Page } from "./pagination";
import { API_KEY_RATE_LIMIT, apiKeyLimiter, rateLimitHeaders } from "./rate-limit";
import { hasScope, type ApiScope } from "./scopes";
import { searchParamsToObject, validate, type Infer } from "./schema";

/**
 * Route wrapper for REST API v1.
 *
 * `apiRoute(endpoints.x, handler)` returns a Next.js route handler that, in
 * order: checks the API is switched on, authenticates the bearer key,
 * applies the per-key rate limit, checks the endpoint's scope, validates
 * path parameters, query string and JSON body against the endpoint
 * definition, then runs `handler`. Every response carries `X-Request-Id`,
 * `X-RateLimit-*` (once the key is known) and `Cache-Control: no-store`.
 * `ApiError`s become the error envelope; anything else is logged to the
 * admin error log and answered with a generic 500.
 */

/** Largest JSON body accepted (a 50,000-character Markdown description fits comfortably). */
export const MAX_BODY_BYTES = 512 * 1024;
const MAX_PARAM_LENGTH = 200;

type QueryOf<D extends EndpointDef> = D["query"] extends NonNullable<EndpointDef["query"]> ? Infer<D["query"]> : Record<string, never>;
type BodyOf<D extends EndpointDef> = D["body"] extends NonNullable<EndpointDef["body"]> ? Infer<D["body"]> : Record<string, never>;

export interface ApiContext<D extends EndpointDef> {
  request: NextRequest;
  url: URL;
  requestId: string;
  key: ApiKey;
  /** The member who created the key: recorded as the actor of changes made with it. */
  actorId: string;
  db: Database;
  /** Site origin for absolute URLs. */
  baseUrl: string;
  params: Record<string, string>;
  query: QueryOf<D>;
  body: BodyOf<D>;
  /** Whether the key also has another scope (e.g. lesson content with courses:write). */
  can(scope: ApiScope): boolean;
  /** Record a change in the admin audit log, attributed to the key's creator and tagged with the key. */
  audit(action: string, target?: { type: string; id: string }, meta?: AuditEvent["meta"]): Promise<void>;
}

type RouteContextLike = { params: Promise<Record<string, string | string[] | undefined>> };

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

/** `{ data }` response. */
export function dataResponse(data: unknown, status = 200): Response {
  return NextResponse.json({ data }, { status });
}

/** `{ data, meta }` response for a page, with a `Link` header. */
export function listResponse<T, R>(page: Page<T>, url: URL, map: (item: T) => R): Response {
  const response = NextResponse.json({ data: page.items.map(map), meta: page.meta });
  const link = linkHeader(url, page.meta);
  if (link) response.headers.set("Link", link);
  return response;
}

export function errorResponse(error: ApiError): Response {
  return NextResponse.json(error.toBody(), { status: error.status, headers: error.headers });
}

function finish(response: Response, headers: Record<string, string>): Response {
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

async function readJsonBody(request: NextRequest): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(type.trim())) {
    throw new ApiError(415, "unsupported_media_type", "Send the request body as JSON with `Content-Type: application/json`.");
  }
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", `The request body is larger than ${MAX_BODY_BYTES / 1024} KB.`);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", `The request body is larger than ${MAX_BODY_BYTES / 1024} KB.`);
  }
  if (!text.trim()) throw new ApiError(400, "invalid_json", "The request body is empty. Send a JSON object.");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const reason = error instanceof SyntaxError ? error.message : "Invalid JSON";
    throw new ApiError(400, "invalid_json", `The request body is not valid JSON: ${reason.slice(0, 200)}`);
  }
}

async function readParams(def: EndpointDef, context: RouteContextLike): Promise<Record<string, string>> {
  const raw = await context.params;
  const out: Record<string, string> = {};
  const details: Record<string, string> = {};
  for (const name of Object.keys(def.params ?? {})) {
    const value = raw[name];
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) details[name] = "Missing path parameter.";
    else if (text.length > MAX_PARAM_LENGTH) details[name] = `Must be at most ${MAX_PARAM_LENGTH} characters.`;
    else out[name] = text;
  }
  if (Object.keys(details).length) throw validationError(details, "The URL is not valid.");
  return out;
}

/* ------------------------------------------------------------------ */
/* Wrapper                                                             */
/* ------------------------------------------------------------------ */

export function apiRoute<const D extends EndpointDef>(def: D, handler: (ctx: ApiContext<D>) => Promise<Response>) {
  return async function route(request: NextRequest, context: RouteContextLike): Promise<Response> {
    const requestId = uid("req");
    const headers: Record<string, string> = { "X-Request-Id": requestId };
    const url = new URL(request.url);
    try {
      const db = await getDb();
      if (!db.settings.api.enabled) {
        throw new ApiError(403, "api_disabled", "The API is turned off for this site. An administrator can turn it on in Admin → Settings → API & webhooks.");
      }
      const now = Date.now();
      const key = authenticateApiKey(db, request.headers.get("authorization"), clientIpFromHeaders(request.headers), now);

      const limit = apiKeyLimiter.hit(key.id, API_KEY_RATE_LIMIT, now);
      Object.assign(headers, rateLimitHeaders(limit));
      if (!limit.ok) {
        throw new ApiError(429, "rate_limited", `Rate limit exceeded: ${limit.limit} requests per minute per key. Retry after ${limit.retryAfterSeconds} seconds.`, {
          limit: limit.limit,
          retryAfterSeconds: limit.retryAfterSeconds,
        });
      }
      if (shouldTouchKey(key, now)) after(() => touchApiKey(key.id));

      if (def.scope && !hasScope(key.scopes, def.scope)) {
        throw new ApiError(403, "insufficient_scope", `This API key needs the "${def.scope}" scope for this request.`, { required: def.scope, granted: [...key.scopes] });
      }

      const params = await readParams(def, context);
      let query: Record<string, unknown> = {};
      if (def.query) {
        const checked = validate(def.query, normalizeListQuery(searchParamsToObject(url.searchParams)), { coerce: true });
        if (!checked.ok) throw validationError(checked.details, "Some query parameters are invalid. See details for each one.");
        query = checked.value as Record<string, unknown>;
      }
      let body: Record<string, unknown> = {};
      if (def.body) {
        const checked = validate(def.body, await readJsonBody(request));
        if (!checked.ok) throw validationError(checked.details);
        body = checked.value as Record<string, unknown>;
      }

      const ctx: ApiContext<D> = {
        request,
        url,
        requestId,
        key,
        actorId: key.createdById,
        db,
        baseUrl: siteConfig.appUrl,
        params,
        query: query as QueryOf<D>,
        body: body as BodyOf<D>,
        can: (scope) => hasScope(key.scopes, scope),
        audit: (action, target, meta) => audit({ id: key.createdById }, action, target, { ...meta, apiKeyId: key.id, apiKey: key.prefix, requestId }),
      };
      return finish(await handler(ctx), headers);
    } catch (error) {
      if (error instanceof ApiError) return finish(errorResponse(error), headers);
      const failure = error instanceof Error ? error : new Error(String(error));
      console.error(`[api] ${request.method} ${url.pathname} failed (${requestId}):`, failure.message);
      await recordError({ message: failure.message, stack: failure.stack, path: url.pathname, method: request.method });
      return finish(errorResponse(new ApiError(500, "internal_error", `Something went wrong on our side. Quote request id ${requestId} if you contact support.`)), headers);
    }
  };
}
