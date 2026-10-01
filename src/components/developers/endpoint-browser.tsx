"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EndpointDoc } from "@/lib/api/docs";
import { NO_ENDPOINT_FILTER, filterEndpointDocs, groupEndpointDocs, type EndpointFilter } from "@/lib/api/docs-filter";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { tagAnchor } from "./anchors";
import { EndpointCard } from "./endpoint-card";

/**
 * The endpoint reference with search and filters. Each endpoint is anchored
 * at its operationId (`/developers#listCourses`).
 */
export function EndpointBrowser({ docs, tags }: { docs: readonly EndpointDoc[]; tags: readonly string[] }) {
  const [filter, setFilter] = useState<EndpointFilter>(NO_ENDPOINT_FILTER);
  const root = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => filterEndpointDocs(docs, filter), [docs, filter]);
  const groups = useMemo(() => groupEndpointDocs(matches, tags), [matches, tags]);
  const filtered = filter.q !== "" || filter.tag !== "" || filter.method !== "";
  const methods = useMemo(() => [...new Set(docs.map((doc) => doc.method))], [docs]);

  useEffect(() => {
    // A filter may hide the endpoint a link points to: clear it so `HashOpener` can open it.
    const revealFromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id && docs.some((doc) => doc.id === id) && !document.getElementById(id)) setFilter(NO_ENDPOINT_FILTER);
    };
    revealFromHash();
    window.addEventListener("hashchange", revealFromHash);
    return () => window.removeEventListener("hashchange", revealFromHash);
  }, [docs]);

  const setAll = (open: boolean) => {
    root.current?.querySelectorAll("details").forEach((element) => {
      element.open = open;
    });
  };

  return (
    <div ref={root}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <label htmlFor="endpoint-search" className="sr-only">
            Search endpoints
          </label>
          <Input
            id="endpoint-search"
            type="search"
            value={filter.q}
            onChange={(event) => setFilter((current) => ({ ...current, q: event.target.value }))}
            placeholder="Search endpoints, fields or scopes"
            leftAddon={<Icon.Search className="size-4" />}
            autoComplete="off"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <label htmlFor="endpoint-tag" className="sr-only">
            Resource
          </label>
          <Select
            id="endpoint-tag"
            value={filter.tag}
            onChange={(event) => setFilter((current) => ({ ...current, tag: event.target.value }))}
            options={[{ value: "", label: "All resources" }, ...tags.map((tag) => ({ value: tag, label: tag }))]}
            className="sm:w-40"
          />
          <label htmlFor="endpoint-method" className="sr-only">
            Method
          </label>
          <Select
            id="endpoint-method"
            value={filter.method}
            onChange={(event) => setFilter((current) => ({ ...current, method: event.target.value }))}
            options={[{ value: "", label: "All methods" }, ...methods.map((method) => ({ value: method, label: method }))]}
            className="sm:w-36"
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <p aria-live="polite">
          {filtered ? `${matches.length} of ${docs.length} endpoints` : `${docs.length} endpoints`}
        </p>
        <div className="flex gap-1">
          {filtered && (
            <Button variant="ghost" size="xs" onClick={() => setFilter(NO_ENDPOINT_FILTER)}>
              Clear filters
            </Button>
          )}
          <Button variant="ghost" size="xs" onClick={() => setAll(true)} disabled={!matches.length}>
            Expand all
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setAll(false)} disabled={!matches.length}>
            Collapse all
          </Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          compact
          icon={<Icon.Search />}
          title="No endpoint matches"
          description="Try another word, or clear the filters to see every endpoint."
          action={
            <Button variant="outline" size="sm" onClick={() => setFilter(NO_ENDPOINT_FILTER)}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.tag} id={tagAnchor(group.tag)} aria-labelledby={`${tagAnchor(group.tag)}-title`} className="scroll-mt-24">
              <h3 id={`${tagAnchor(group.tag)}-title`} className="mb-2 text-base font-semibold text-ink">
                {group.tag}
              </h3>
              <div className="space-y-2">
                {group.endpoints.map((doc) => (
                  <EndpointCard key={doc.id} doc={doc} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
