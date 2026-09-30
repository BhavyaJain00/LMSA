/**
 * API key scopes.
 *
 * A key only reaches the endpoints its scopes allow. A `:write` scope also
 * grants the matching `:read` scope (a key that may update courses may read
 * them), nothing else is implied.
 *
 * Pure module with no runtime imports: shared by the API, the admin key
 * manager and the developer docs.
 */

export const API_SCOPES = [
  { id: "courses:read", resource: "Courses", access: "read", description: "List courses and batches and read course outlines." },
  { id: "courses:write", resource: "Courses", access: "write", description: "Create and update courses, and read lesson content." },
  { id: "users:read", resource: "Users", access: "read", description: "List members and read their profiles." },
  { id: "users:write", resource: "Users", access: "write", description: "Create members and update their profiles." },
  { id: "enrollments:read", resource: "Enrollments", access: "read", description: "List course enrollments." },
  { id: "enrollments:write", resource: "Enrollments", access: "write", description: "Enroll members in courses and batches, and remove enrollments." },
  { id: "payments:read", resource: "Payments", access: "read", description: "List orders and payments." },
  { id: "progress:read", resource: "Progress", access: "read", description: "Read lesson progress and issued certificates." },
  { id: "webhooks:manage", resource: "Webhooks", access: "manage", description: "Create, change and remove webhook endpoints." },
] as const satisfies readonly { id: string; resource: string; access: "read" | "write" | "manage"; description: string }[];

export type ApiScope = (typeof API_SCOPES)[number]["id"];

export const API_SCOPE_IDS: readonly ApiScope[] = API_SCOPES.map((scope) => scope.id);

/** Scopes that only read data (the "Read only" preset). */
export const READ_ONLY_SCOPES: readonly ApiScope[] = API_SCOPES.filter((scope) => scope.access === "read").map((scope) => scope.id);

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && (API_SCOPE_IDS as readonly string[]).includes(value);
}

export function describeScope(scope: string): string {
  return API_SCOPES.find((s) => s.id === scope)?.description ?? scope;
}

/** Whether `granted` allows `required` (`x:write` includes `x:read`). */
export function hasScope(granted: readonly string[], required: ApiScope): boolean {
  if (granted.includes(required)) return true;
  const [resource, access] = required.split(":");
  return access === "read" && granted.includes(`${resource}:write`);
}

/** Known scopes only, without duplicates, in the canonical order of `API_SCOPES`. */
export function normalizeScopes(input: readonly unknown[]): ApiScope[] {
  const wanted = new Set(input.filter(isApiScope));
  return API_SCOPE_IDS.filter((id) => wanted.has(id));
}

/** Resources with their read/write/manage scopes, for the scope picker. */
export const SCOPE_GROUPS: readonly { resource: string; scopes: (typeof API_SCOPES)[number][] }[] = (() => {
  const groups = new Map<string, (typeof API_SCOPES)[number][]>();
  for (const scope of API_SCOPES) {
    const list = groups.get(scope.resource) ?? [];
    list.push(scope);
    groups.set(scope.resource, list);
  }
  return [...groups].map(([resource, scopes]) => ({ resource, scopes }));
})();
