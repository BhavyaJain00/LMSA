import type { ApiErrorCode } from "./errors";
import { responseExample } from "./examples";
import type { ApiResourceName, ApiTag, EndpointDef, HttpMethod } from "./endpoints";
import { errorDescription, errorStatusesFor } from "./openapi";
import type { ObjectSchema, Schema } from "./schema";
import { describeScope } from "./scopes";

/**
 * View models for the /developers reference, built from the endpoint
 * registry (`endpoints.ts`). Everything here is plain serializable data so
 * the interactive endpoint browser (a client component) can receive it.
 */

export type ParamLocation = "path" | "query" | "body";

export interface DocParam {
  name: string;
  in: ParamLocation;
  /** Readable type: "string", "integer", "boolean", "string (email)", "enum", "string[]". */
  type: string;
  required: boolean;
  nullable: boolean;
  description: string | null;
  /** Allowed values of an enum. */
  values: string[] | null;
  /** Limits in words: "1–140 characters", "1–100", "up to 12 items". */
  constraints: string[];
  /** The value used in the documented request, as text. */
  example: string | null;
}

export interface EndpointDoc {
  id: string;
  method: HttpMethod;
  /** Path relative to /api/v1, in OpenAPI syntax. */
  path: string;
  tag: ApiTag;
  summary: string;
  description: string | null;
  scope: string | null;
  scopeDescription: string | null;
  params: DocParam[];
  query: DocParam[];
  body: DocParam[];
  /** Rules that span several body fields ("Send userId or email"). */
  bodyRules: string[];
  curl: string;
  javascript: string;
  response: { status: number; description: string; resource: ApiResourceName; list: boolean; example: string };
  alsoReturns: { status: number; description: string }[];
  errors: { status: number; description: string }[];
}

/* ------------------------------------------------------------------ */
/* Parameters                                                          */
/* ------------------------------------------------------------------ */

const FORMAT_LABELS: Record<string, string> = {
  email: "email",
  url: "URL",
  "date-time": "ISO 8601 date-time",
  date: "YYYY-MM-DD",
  slug: "slug",
  username: "username",
};

function typeLabel(schema: Schema): string {
  switch (schema.kind) {
    case "string":
      if (schema.enum) return "enum";
      return schema.format ? `string (${FORMAT_LABELS[schema.format] ?? schema.format})` : "string";
    case "integer":
      return "integer";
    case "boolean":
      return "boolean";
    case "array":
      return `${typeLabel(schema.items)}[]`;
    case "object":
      return "object";
  }
}

function range(min: number | undefined, max: number | undefined, unit = ""): string | null {
  const suffix = unit ? ` ${unit}` : "";
  if (min !== undefined && max !== undefined) return min === max ? `exactly ${min}${suffix}` : `${min}–${max}${suffix}`;
  if (max !== undefined) return `at most ${max}${suffix}`;
  if (min !== undefined) return `at least ${min}${suffix}`;
  return null;
}

function constraintsOf(schema: Schema): string[] {
  const out: string[] = [];
  switch (schema.kind) {
    case "string": {
      if (schema.enum) break;
      const length = range(schema.minLength, schema.maxLength, "characters");
      if (length && !(schema.minLength === 1 && schema.maxLength === undefined)) out.push(length);
      else if (schema.minLength === 1) out.push("not empty");
      if (schema.lowercase) out.push("case-insensitive");
      break;
    }
    case "integer": {
      const span = range(schema.minimum, schema.maximum);
      if (span) out.push(span);
      break;
    }
    case "array": {
      if (schema.maxItems !== undefined) out.push(`up to ${schema.maxItems} items`);
      if (schema.dedupe) out.push("duplicates ignored");
      if (schema.items.kind === "string" && schema.items.maxLength !== undefined) out.push(`each at most ${schema.items.maxLength} characters`);
      break;
    }
    default:
      break;
  }
  return out;
}

function valuesOf(schema: Schema): string[] | null {
  if (schema.kind === "string" && schema.enum) return [...schema.enum];
  if (schema.kind === "array" && schema.items.kind === "string" && schema.items.enum) return [...schema.items.enum];
  return null;
}

function exampleText(value: unknown): string | null {
  if (value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The documented fields of a query or body schema, required ones first (declaration order otherwise). */
export function schemaParams(schema: ObjectSchema<Record<string, Schema>>, location: "query" | "body", examples: Record<string, unknown> = {}): DocParam[] {
  const params = Object.entries(schema.properties).map(
    ([name, prop]): DocParam => ({
      name,
      in: location,
      type: typeLabel(prop),
      required: !prop.optional,
      nullable: !!prop.nullable,
      description: prop.description ?? null,
      values: valuesOf(prop),
      constraints: constraintsOf(prop),
      example: exampleText(examples[name] ?? prop.example),
    }),
  );
  return [...params.filter((p) => p.required), ...params.filter((p) => !p.required)];
}

function bodyRules(schema: ObjectSchema<Record<string, Schema>> | undefined): string[] {
  if (!schema) return [];
  const rules: string[] = [];
  if (schema.anyOf?.length) rules.push(`Send ${schema.anyOf.map((key) => `\`${key}\``).join(" or ")}.`);
  if (schema.nonEmpty) rules.push("Send at least one field. Fields you leave out keep their current value.");
  if (!schema.allowUnknown) rules.push("Unknown fields are refused with a 400, so typos never go unnoticed.");
  return rules;
}

/* ------------------------------------------------------------------ */
/* Example requests                                                    */
/* ------------------------------------------------------------------ */

/** Environment variable the examples read the key from. */
export const API_KEY_ENV = "LL_API_KEY";

/** Absolute URL of the documented request: path parameters filled in, example query appended. */
export function exampleUrl(def: Pick<EndpointDef, "path" | "examples">, baseUrl: string): string {
  const path = def.path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(def.examples?.params?.[name] ?? `<${name}>`));
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(def.examples?.query ?? {})) query.set(name, String(value));
  const search = query.size ? `?${query.toString()}` : "";
  return `${baseUrl}/api/v1${path === "/" ? "" : path}${search}`;
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The documented request as a curl command (the key comes from $LL_API_KEY). */
export function curlExample(def: Pick<EndpointDef, "method" | "path" | "examples" | "body">, baseUrl: string): string {
  const lines = [`curl ${def.method === "GET" ? "" : `-X ${def.method} `}"${exampleUrl(def, baseUrl)}"`, `-H "Authorization: Bearer $${API_KEY_ENV}"`];
  if (def.body) {
    lines.push(`-H "Content-Type: application/json"`);
    lines.push(`-d ${shellQuote(JSON.stringify(def.examples?.body ?? {}, null, 2))}`);
  }
  return lines.join(" \\\n  ");
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : pad + line))
    .join("\n");
}

/** The documented request with `fetch` (Node 18+ or a browser-free runtime; never ship the key to a browser). */
export function fetchExample(def: Pick<EndpointDef, "method" | "path" | "examples" | "body" | "response">, baseUrl: string): string {
  const options: string[] = [];
  if (def.method !== "GET") options.push(`  method: "${def.method}",`);
  const headers = [`    Authorization: \`Bearer \${process.env.${API_KEY_ENV}}\`,`];
  if (def.body) headers.push(`    "Content-Type": "application/json",`);
  options.push(`  headers: {\n${headers.join("\n")}\n  },`);
  if (def.body) options.push(`  body: JSON.stringify(${indent(JSON.stringify(def.examples?.body ?? {}, null, 2), 2)}),`);
  const result = def.response.list ? "const { data, meta } = await response.json();" : "const { data } = await response.json();";
  return [
    `const response = await fetch("${exampleUrl(def, baseUrl)}", {`,
    ...options,
    "});",
    "if (!response.ok) throw new Error((await response.json()).error.message);",
    result,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export function buildEndpointDoc(def: EndpointDef, baseUrl: string): EndpointDoc {
  return {
    id: def.id,
    method: def.method,
    path: def.path,
    tag: def.tag,
    summary: def.summary,
    description: def.description ?? null,
    scope: def.scope,
    scopeDescription: def.scope ? describeScope(def.scope) : null,
    params: Object.entries(def.params ?? {}).map(([name, description]) => ({
      name,
      in: "path",
      type: "string",
      required: true,
      nullable: false,
      description,
      values: null,
      constraints: [],
      example: def.examples?.params?.[name] ?? null,
    })),
    query: def.query ? schemaParams(def.query, "query", def.examples?.query) : [],
    body: def.body ? schemaParams(def.body, "body", def.examples?.body) : [],
    bodyRules: bodyRules(def.body),
    curl: curlExample(def, baseUrl),
    javascript: fetchExample(def, baseUrl),
    response: {
      status: def.response.status,
      description: def.response.description,
      resource: def.response.resource,
      list: !!def.response.list,
      example: JSON.stringify(responseExample(def.response, baseUrl), null, 2),
    },
    alsoReturns: [...(def.alsoReturns ?? [])],
    errors: errorStatusesFor(def).map((status) => ({ status, description: errorDescription(status) })),
  };
}

export function buildEndpointDocs(defs: readonly EndpointDef[], baseUrl: string): EndpointDoc[] {
  return defs.map((def) => buildEndpointDoc(def, baseUrl));
}

/* ------------------------------------------------------------------ */
/* Error codes                                                         */
/* ------------------------------------------------------------------ */

/** Every `error.code` the API answers with, its HTTP status and meaning. */
export const ERROR_CODES: Record<ApiErrorCode, { status: number; description: string }> = {
  validation_failed: { status: 400, description: "A field is missing or invalid. `details` maps each field path to its problem." },
  invalid_json: { status: 400, description: "The body is not valid JSON." },
  unauthorized: { status: 401, description: "No `Authorization: Bearer` header was sent." },
  invalid_api_key: { status: 401, description: "The key is malformed or unknown, or its creator is no longer an enabled administrator." },
  revoked_api_key: { status: 401, description: "The key was revoked. Create a new one." },
  insufficient_scope: { status: 403, description: "The key lacks the scope the endpoint needs. `details.required` names it." },
  api_disabled: { status: 403, description: "The site's administrators switched the API off." },
  forbidden: { status: 403, description: "The change is not allowed through the API (for example, editing an administrator)." },
  not_found: { status: 404, description: "The resource does not exist, or the path is not part of the API." },
  method_not_allowed: { status: 405, description: "The path does not support this method. The `Allow` header lists the ones it does." },
  conflict: { status: 409, description: "The request clashes with existing data (a taken slug or email, a full batch)." },
  payload_too_large: { status: 413, description: "The body is larger than the API accepts." },
  unsupported_media_type: { status: 415, description: "Send the body as `application/json`." },
  rate_limited: { status: 429, description: "The key's per-minute allowance is used up, or too many requests with invalid keys came from your address. Wait `Retry-After` seconds." },
  internal_error: { status: 500, description: "Something failed on the server. It is logged; quote the `X-Request-Id` header when you report it." },
};
