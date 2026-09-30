import { siteConfig } from "@/lib/config";
import { API_TAGS, ENDPOINT_LIST, type EndpointDef } from "./endpoints";
import { API_KEY_RATE_LIMIT } from "./rate-limit";
import { toJsonSchema, type JsonSchema } from "./schema";
import { API_SCOPE_IDS, describeScope } from "./scopes";

/**
 * OpenAPI 3.1 document for REST API v1, generated from the endpoint registry
 * (`ENDPOINT_LIST`). Route handlers validate against the same definitions, so
 * the published contract cannot drift from what the API accepts.
 */

export const OPENAPI_VERSION = "3.1.0";
export const API_VERSION = "1.0.0";

/** Errors any endpoint can answer with, whatever its definition says. */
export const SHARED_ERROR_STATUSES: readonly number[] = [401, 403, 429, 500];

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "The path, query string or JSON body failed validation. `error.details` names each invalid field.",
  401: "The API key is missing, malformed, unknown or revoked.",
  403: "The key lacks the scope this endpoint needs, or the API is switched off.",
  404: "The resource does not exist.",
  405: "The path exists but does not support this method. The `Allow` header lists the ones it does.",
  409: "The request conflicts with the current state of the resource.",
  413: "The JSON body is larger than the API accepts.",
  415: "The body must be sent as `application/json`.",
  429: "The key's rate limit is used up. Retry after the number of seconds in `Retry-After`.",
  500: "Something failed on the server. The error is logged for the site's admins.",
};

export function errorDescription(status: number): string {
  return ERROR_DESCRIPTIONS[status] ?? "The request could not be completed.";
}

/** Every error status an endpoint documents: its own plus the shared ones, ascending. */
export function errorStatusesFor(def: Pick<EndpointDef, "errors">): number[] {
  return [...new Set([...def.errors, ...SHARED_ERROR_STATUSES])].sort((a, b) => a - b);
}

const ERROR_REF = { $ref: "#/components/schemas/Error" };

const RATE_LIMIT_HEADERS: JsonSchema = {
  "X-RateLimit-Limit": { description: "Requests the key may make per window.", schema: { type: "integer" } },
  "X-RateLimit-Remaining": { description: "Requests left in the current window.", schema: { type: "integer" } },
  "X-RateLimit-Reset": { description: "Unix time (seconds) when the window resets.", schema: { type: "integer" } },
};

function parametersFor(def: EndpointDef): JsonSchema[] {
  const parameters: JsonSchema[] = [];
  for (const [name, description] of Object.entries(def.params ?? {})) {
    const example = def.examples?.params?.[name];
    parameters.push({ name, in: "path", required: true, description, schema: { type: "string" }, ...(example === undefined ? {} : { example }) });
  }
  if (def.query) {
    const schema = toJsonSchema(def.query);
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    for (const [name, property] of Object.entries(properties)) {
      const { description, ...rest } = property;
      const example = def.examples?.query?.[name];
      parameters.push({
        name,
        in: "query",
        required: required.has(name),
        ...(typeof description === "string" ? { description } : {}),
        schema: rest,
        ...(example === undefined ? {} : { example }),
      });
    }
  }
  return parameters;
}

function successSchema(def: EndpointDef): JsonSchema {
  const resource = { $ref: `#/components/schemas/${def.response.resource}` };
  if (!def.response.list) return { type: "object", required: ["data"], properties: { data: resource } };
  return {
    type: "object",
    required: ["data", "meta"],
    properties: { data: { type: "array", items: resource }, meta: { $ref: "#/components/schemas/PageMeta" } },
  };
}

function responsesFor(def: EndpointDef): JsonSchema {
  const content = { "application/json": { schema: successSchema(def) } };
  const responses: Record<string, JsonSchema> = {
    [String(def.response.status)]: { description: def.response.description, headers: RATE_LIMIT_HEADERS, content },
  };
  for (const extra of def.alsoReturns ?? []) {
    responses[String(extra.status)] = { description: extra.description, headers: RATE_LIMIT_HEADERS, content };
  }
  for (const status of errorStatusesFor(def)) {
    responses[String(status)] = {
      description: errorDescription(status),
      ...(status === 429 ? { headers: { "Retry-After": { description: "Seconds to wait before retrying.", schema: { type: "integer" } } } } : {}),
      content: { "application/json": { schema: ERROR_REF } },
    };
  }
  return responses;
}

function operationFor(def: EndpointDef): JsonSchema {
  const parameters = parametersFor(def);
  const body = def.examples?.body;
  return {
    operationId: def.id,
    tags: [def.tag],
    summary: def.summary,
    ...(def.description ? { description: def.description } : {}),
    security: [{ apiKey: def.scope ? [def.scope] : [] }],
    ...(def.scope ? { "x-required-scope": def.scope } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(def.body
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: toJsonSchema(def.body), ...(body ? { example: body } : {}) } },
          },
        }
      : {}),
    responses: responsesFor(def),
  };
}

/** Response payloads are described on /developers; the document names each one so clients can group them. */
function resourceSchemas(defs: readonly EndpointDef[]): Record<string, JsonSchema> {
  const schemas: Record<string, JsonSchema> = {};
  for (const name of [...new Set(defs.map((def) => def.response.resource))].sort()) {
    schemas[name] = { type: "object", title: name, additionalProperties: true };
  }
  return schemas;
}

export function buildOpenApiDocument(defs: readonly EndpointDef[] = ENDPOINT_LIST, baseUrl: string = siteConfig.appUrl): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {};
  for (const def of defs) {
    (paths[def.path] ??= {})[def.method.toLowerCase()] = operationFor(def);
  }
  const usedTags = new Set(defs.map((def) => def.tag));
  const perMinute = Math.round((API_KEY_RATE_LIMIT.limit * 60_000) / API_KEY_RATE_LIMIT.windowMs);
  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: `${siteConfig.name} REST API`,
      version: API_VERSION,
      description: [
        "JSON API for courses, users, enrollments, progress, payments, certificates, batches and webhooks.",
        "Send the API key as `Authorization: Bearer <key>`. Each key carries scopes; a write scope includes the matching read scope.",
        `Every key may make ${perMinute} requests per minute. Responses carry X-RateLimit-* headers, and 429 answers carry Retry-After.`,
        "Successful responses use the envelope `{ data, meta }`; errors use `{ error: { code, message, details } }`. Dates are ISO 8601 in UTC.",
      ].join("\n\n"),
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    tags: API_TAGS.filter((tag) => usedTags.has(tag)).map((name) => ({ name })),
    security: [{ apiKey: [] }],
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "ll_live_<id>_<secret>",
          description: `Scopes: ${API_SCOPE_IDS.map((scope) => `\`${scope}\` (${describeScope(scope)})`).join(", ")}.`,
        },
      },
      schemas: {
        ...resourceSchemas(defs),
        PageMeta: {
          type: "object",
          required: ["page", "perPage", "total"],
          properties: { page: { type: "integer", minimum: 1 }, perPage: { type: "integer", minimum: 1 }, total: { type: "integer", minimum: 0 } },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message", "details"],
              properties: {
                code: { type: "string", description: "Stable machine-readable code, e.g. `validation_failed`." },
                message: { type: "string" },
                details: { type: ["object", "null"], additionalProperties: true },
              },
            },
          },
        },
      },
    },
  };
}
