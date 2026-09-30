/**
 * A tiny schema language for the public REST API.
 *
 * Every endpoint describes its query string and JSON body with these
 * builders. The same description is used to:
 *  - validate and coerce input, with a precise message per field
 *    (`validate`), and
 *  - describe the endpoint in the OpenAPI document (`toJsonSchema`).
 *
 * The TypeScript type of a validated value is inferred from the schema
 * (`Infer<typeof schema>`), so handlers never cast request input.
 *
 * Pure module (no Node or Next APIs): safe to import anywhere and unit test.
 */

export type StringFormat = "email" | "url" | "date-time" | "date" | "slug" | "username";

interface Common {
  description?: string;
  example?: unknown;
  /** The field may be left out of an object. */
  optional?: boolean;
  /** `null` is accepted (e.g. to clear a value). */
  nullable?: boolean;
}

export interface StringSchema<E extends string = string> extends Common {
  kind: "string";
  minLength?: number;
  maxLength?: number;
  format?: StringFormat;
  /** Allowed values. */
  enum?: readonly E[];
  /** Lower-case the value before checking it (emails, usernames, slugs). */
  lowercase?: boolean;
  /** Keep surrounding whitespace (strings are trimmed by default). */
  raw?: boolean;
}

export interface IntegerSchema extends Common {
  kind: "integer";
  minimum?: number;
  maximum?: number;
}

export interface BooleanSchema extends Common {
  kind: "boolean";
}

export interface ArraySchema<I extends Schema = Schema> extends Common {
  kind: "array";
  items: I;
  maxItems?: number;
  /** Drop duplicate primitive values instead of failing. */
  dedupe?: boolean;
}

export interface ObjectSchema<P extends Record<string, Schema> = Record<string, Schema>> extends Common {
  kind: "object";
  properties: P;
  /** At least one of these properties must be present. */
  anyOf?: readonly (keyof P & string)[];
  /** Accept (and drop) properties that are not declared. Bodies are strict; query strings are lenient. */
  allowUnknown?: boolean;
  /** Reject an object with none of its properties set (PATCH bodies). */
  nonEmpty?: boolean;
}

export type Schema = StringSchema<string> | IntegerSchema | BooleanSchema | ArraySchema<Schema> | ObjectSchema<Record<string, Schema>>;

/* ------------------------------------------------------------------ */
/* Type inference                                                      */
/* ------------------------------------------------------------------ */

type Base<S> = S extends StringSchema<infer E>
  ? E
  : S extends IntegerSchema
    ? number
    : S extends BooleanSchema
      ? boolean
      : S extends ArraySchema<infer I>
        ? Infer<I>[]
        : S extends ObjectSchema<infer P>
          ? InferObject<P>
          : never;

type WithNull<S> = S extends { nullable: true } ? Base<S> | null : Base<S>;

type OptionalKeys<P> = { [K in keyof P]: P[K] extends { optional: true } ? K : never }[keyof P];
type RequiredKeys<P> = Exclude<keyof P, OptionalKeys<P>>;

type Flatten<T> = { [K in keyof T]: T[K] } & {};

export type InferObject<P> = Flatten<{ [K in RequiredKeys<P>]: WithNull<P[K]> } & { [K in OptionalKeys<P>]?: WithNull<P[K]> }>;

/** The validated value of a schema. */
export type Infer<S> = WithNull<S>;

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

type Opts<S> = Omit<S, "kind">;

export const s = {
  string<const O extends Opts<StringSchema<string>> = Record<never, never>>(opts?: O): O & { kind: "string" } {
    return { ...(opts ?? ({} as O)), kind: "string" };
  },
  enum<const E extends string, const O extends Opts<StringSchema<E>> = Record<never, never>>(values: readonly E[], opts?: O): O & StringSchema<E> & { kind: "string"; enum: readonly E[] } {
    return { ...(opts ?? ({} as O)), kind: "string", enum: values } as O & StringSchema<E> & { kind: "string"; enum: readonly E[] };
  },
  integer<const O extends Opts<IntegerSchema> = Record<never, never>>(opts?: O): O & { kind: "integer" } {
    return { ...(opts ?? ({} as O)), kind: "integer" };
  },
  boolean<const O extends Opts<BooleanSchema> = Record<never, never>>(opts?: O): O & { kind: "boolean" } {
    return { ...(opts ?? ({} as O)), kind: "boolean" };
  },
  array<I extends Schema, const O extends Omit<Opts<ArraySchema<I>>, "items"> = Record<never, never>>(items: I, opts?: O): O & { kind: "array"; items: I } {
    return { ...(opts ?? ({} as O)), kind: "array", items };
  },
  object<P extends Record<string, Schema>, const O extends Omit<Opts<ObjectSchema<P>>, "properties"> = Record<never, never>>(
    properties: P,
    opts?: O,
  ): O & { kind: "object"; properties: P } {
    return { ...(opts ?? ({} as O)), kind: "object", properties };
  },
};

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type ValidationDetails = Record<string, string>;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; details: ValidationDetails };

export interface ValidateOptions {
  /**
   * Values come from a query string: numbers and booleans arrive as text and
   * are converted ("25" → 25, "true"/"1" → true).
   */
  coerce?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_-]{1,38}[a-z0-9])?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i;
const MAX_INTEGER = Number.MAX_SAFE_INTEGER;

/** True for a real calendar day in YYYY-MM-DD form. */
export function isIsoDay(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Epoch ms of an ISO 8601 date or date-time (a day means 00:00 UTC), or null. */
export function parseIsoTimestamp(value: string): number | null {
  const text = value.trim();
  if (!DATE_TIME_RE.test(text)) return null;
  if (DATE_RE.test(text)) return isIsoDay(text) ? Date.parse(`${text}T00:00:00.000Z`) : null;
  if (!isIsoDay(text.slice(0, 10))) return null;
  const time = Date.parse(text.replace(" ", "T"));
  return Number.isFinite(time) ? time : null;
}

function isHttpUrl(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function checkFormat(format: StringFormat, value: string): string | null {
  switch (format) {
    case "email":
      return value.length <= 254 && EMAIL_RE.test(value) ? null : "Must be a valid email address.";
    case "url":
      return isHttpUrl(value) ? null : "Must be an http(s) URL or a path starting with /.";
    case "date":
      return isIsoDay(value) ? null : "Must be a date in YYYY-MM-DD format.";
    case "date-time":
      return parseIsoTimestamp(value) !== null ? null : "Must be an ISO 8601 date or date-time, e.g. 2026-01-31T09:30:00Z.";
    case "slug":
      return SLUG_RE.test(value) ? null : "Use lowercase letters, numbers and single hyphens only.";
    case "username":
      return value.length >= 3 && value.length <= 40 && USERNAME_RE.test(value) ? null : "Use 3–40 lowercase letters, numbers, dashes or underscores.";
  }
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return `a ${typeof value}`;
}

function quoteList(values: readonly string[]): string {
  return values.map((v) => `"${v}"`).join(", ");
}

function child(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function run(schema: Schema, input: unknown, path: string, details: ValidationDetails, opts: ValidateOptions): unknown {
  const at = path || "body";
  if (input === null) {
    if (schema.nullable) return null;
    details[at] = "Must not be null.";
    return undefined;
  }
  switch (schema.kind) {
    case "string": {
      if (typeof input !== "string") {
        details[at] = `Must be a string, got ${describeType(input)}.`;
        return undefined;
      }
      let value = schema.raw ? input : input.trim();
      if (schema.lowercase) value = value.toLowerCase();
      if (schema.enum) {
        if (!schema.enum.includes(value)) details[at] = `Must be one of ${quoteList(schema.enum)}.`;
        return value;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        details[at] = schema.minLength === 1 ? "Must not be empty." : `Must be at least ${schema.minLength} characters.`;
        return value;
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        details[at] = `Must be at most ${schema.maxLength} characters.`;
        return value;
      }
      if (schema.format && value !== "") {
        const problem = checkFormat(schema.format, value);
        if (problem) details[at] = problem;
      }
      return value;
    }
    case "integer": {
      let value: unknown = input;
      if (opts.coerce && typeof input === "string") {
        const text = input.trim();
        value = /^-?\d{1,16}$/.test(text) ? Number(text) : Number.NaN;
      }
      if (typeof value !== "number" || !Number.isInteger(value) || Math.abs(value) > MAX_INTEGER) {
        details[at] = opts.coerce && typeof input === "string" ? "Must be a whole number." : `Must be a whole number, got ${describeType(input)}.`;
        return undefined;
      }
      if (schema.minimum !== undefined && value < schema.minimum) details[at] = `Must be ${schema.minimum} or more.`;
      else if (schema.maximum !== undefined && value > schema.maximum) details[at] = `Must be ${schema.maximum} or less.`;
      return value;
    }
    case "boolean": {
      if (typeof input === "boolean") return input;
      if (opts.coerce && typeof input === "string") {
        const text = input.trim().toLowerCase();
        if (text === "true" || text === "1") return true;
        if (text === "false" || text === "0") return false;
        details[at] = 'Must be "true" or "false".';
        return undefined;
      }
      details[at] = `Must be true or false, got ${describeType(input)}.`;
      return undefined;
    }
    case "array": {
      let list: unknown[];
      if (Array.isArray(input)) list = input;
      else if (opts.coerce && typeof input === "string") list = input.split(",").map((part) => part.trim()).filter(Boolean);
      else {
        details[at] = `Must be an array, got ${describeType(input)}.`;
        return undefined;
      }
      if (schema.maxItems !== undefined && list.length > schema.maxItems) {
        details[at] = `Must have at most ${schema.maxItems} items.`;
        return undefined;
      }
      const out = list.map((item, index) => run(schema.items, item, child(path || "body", index), details, opts));
      if (!schema.dedupe) return out;
      const seen = new Set<unknown>();
      return out.filter((item) => {
        const key = typeof item === "string" ? item.toLowerCase() : item;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    case "object": {
      if (typeof input !== "object" || Array.isArray(input)) {
        details[at] = `Must be a JSON object, got ${describeType(input)}.`;
        return undefined;
      }
      const record = input as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(record)) {
        if (FORBIDDEN_KEYS.has(key) || !Object.hasOwn(schema.properties, key)) {
          // defineProperty: a key such as "__proto__" must become a plain entry, never a prototype change.
          if (!schema.allowUnknown) Object.defineProperty(details, child(path, key), { value: "Unknown field.", enumerable: true, writable: true, configurable: true });
        }
      }
      let present = 0;
      for (const [key, prop] of Object.entries(schema.properties)) {
        const value = Object.hasOwn(record, key) ? record[key] : undefined;
        if (value === undefined || (opts.coerce && value === "")) {
          if (!prop.optional) details[child(path, key)] = "This field is required.";
          continue;
        }
        present++;
        const parsed = run(prop, value, child(path, key), details, opts);
        if (parsed !== undefined) out[key] = parsed;
      }
      if (schema.nonEmpty && present === 0) details[path || "body"] = `Send at least one of ${quoteList(Object.keys(schema.properties))}.`;
      if (schema.anyOf?.length && !schema.anyOf.some((key) => out[key] !== undefined && out[key] !== null)) {
        details[path || "body"] = `Send ${schema.anyOf.length === 1 ? `"${schema.anyOf[0]}"` : `one of ${quoteList(schema.anyOf)}`}.`;
      }
      return out;
    }
  }
}

/** Validate (and, for query strings, coerce) a value against a schema. */
export function validate<S extends Schema>(schema: S, input: unknown, opts: ValidateOptions = {}): ValidationResult<Infer<S>> {
  const details: ValidationDetails = {};
  const value = run(schema, input, "", details, opts);
  if (Object.keys(details).length) return { ok: false, details };
  return { ok: true, value: value as Infer<S> };
}

/** Query string → plain object (the first value of a repeated key wins). */
export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of params) if (!Object.hasOwn(out, key) && !FORBIDDEN_KEYS.has(key)) out[key] = value;
  return out;
}

/* ------------------------------------------------------------------ */
/* JSON Schema (OpenAPI 3.1)                                           */
/* ------------------------------------------------------------------ */

export type JsonSchema = { [key: string]: unknown };

const FORMAT_TO_JSON: Record<StringFormat, { format?: string; pattern?: string }> = {
  email: { format: "email" },
  url: { format: "uri-reference" },
  "date-time": { format: "date-time" },
  date: { format: "date" },
  slug: { pattern: SLUG_RE.source },
  username: { pattern: USERNAME_RE.source },
};

/** The JSON Schema (draft 2020-12, as used by OpenAPI 3.1) of a schema. */
export function toJsonSchema(schema: Schema): JsonSchema {
  let out: JsonSchema;
  switch (schema.kind) {
    case "string":
      out = { type: "string" };
      if (schema.enum) out.enum = [...schema.enum];
      if (schema.minLength !== undefined) out.minLength = schema.minLength;
      if (schema.maxLength !== undefined) out.maxLength = schema.maxLength;
      if (schema.format) Object.assign(out, FORMAT_TO_JSON[schema.format]);
      break;
    case "integer":
      out = { type: "integer" };
      if (schema.minimum !== undefined) out.minimum = schema.minimum;
      if (schema.maximum !== undefined) out.maximum = schema.maximum;
      break;
    case "boolean":
      out = { type: "boolean" };
      break;
    case "array":
      out = { type: "array", items: toJsonSchema(schema.items) };
      if (schema.maxItems !== undefined) out.maxItems = schema.maxItems;
      break;
    case "object": {
      const required = Object.entries(schema.properties)
        .filter(([, prop]) => !prop.optional)
        .map(([key]) => key);
      out = {
        type: "object",
        properties: Object.fromEntries(Object.entries(schema.properties).map(([key, prop]) => [key, toJsonSchema(prop)])),
      };
      if (required.length) out.required = required;
      if (!schema.allowUnknown) out.additionalProperties = false;
      if (schema.nonEmpty) out.minProperties = 1;
      if (schema.anyOf?.length) out.anyOf = schema.anyOf.map((key) => ({ required: [key] }));
      break;
    }
  }
  if (schema.nullable && typeof out.type === "string") out.type = [out.type, "null"];
  if (schema.description) out.description = schema.description;
  if (schema.example !== undefined) out.examples = [schema.example];
  return out;
}
