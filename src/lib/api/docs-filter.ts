import type { EndpointDoc } from "./docs";

/**
 * Search for the /developers endpoint browser. Pure and client-safe (only
 * type imports): it runs in the browser on every keystroke.
 */

export interface EndpointFilter {
  q: string;
  /** API tag, or "" for all. */
  tag: string;
  /** HTTP method, or "" for all. */
  method: string;
}

export const NO_ENDPOINT_FILTER: EndpointFilter = { q: "", tag: "", method: "" };

function haystack(doc: EndpointDoc): string {
  return [
    doc.method,
    doc.path,
    `/api/v1${doc.path === "/" ? "" : doc.path}`,
    doc.summary,
    doc.description ?? "",
    doc.scope ?? "",
    doc.id,
    doc.response.resource,
    ...doc.params.map((p) => p.name),
    ...doc.query.map((p) => p.name),
    ...doc.body.map((p) => p.name),
  ]
    .join(" ")
    .toLowerCase();
}

/** Endpoints matching every word of the query, the tag and the method, in registry order. */
export function filterEndpointDocs(docs: readonly EndpointDoc[], filter: EndpointFilter): EndpointDoc[] {
  const words = filter.q.toLowerCase().split(/\s+/).filter(Boolean);
  return docs.filter((doc) => {
    if (filter.tag && doc.tag !== filter.tag) return false;
    if (filter.method && doc.method !== filter.method) return false;
    if (!words.length) return true;
    const text = haystack(doc);
    return words.every((word) => text.includes(word));
  });
}

/** Endpoints grouped by tag, keeping the order of `tags` and dropping empty groups. */
export function groupEndpointDocs(docs: readonly EndpointDoc[], tags: readonly string[]): { tag: string; endpoints: EndpointDoc[] }[] {
  return tags.map((tag) => ({ tag, endpoints: docs.filter((doc) => doc.tag === tag) })).filter((group) => group.endpoints.length > 0);
}
