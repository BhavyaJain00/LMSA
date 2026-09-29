"use client";

import { useRouter } from "next/navigation";
import { useRef, useTransition, type FormEvent } from "react";
import type { CommunityScope, CommunityTab } from "@/lib/data/community";
import { Button } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";

/**
 * Space filter + search for the community hub. A plain GET form (works
 * without JavaScript); with JavaScript it navigates client-side, drops empty
 * params, and applies the space filter as soon as it changes.
 */
export function CommunityFilters({
  tab,
  scope,
  query,
  scopes,
}: {
  tab: CommunityTab;
  scope: string | null;
  query: string;
  scopes: { courses: CommunityScope[]; batches: CommunityScope[] };
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  const navigate = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const params = new URLSearchParams();
    if (tab !== "latest") params.set("tab", tab);
    const nextScope = String(data.get("scope") ?? "");
    const nextQuery = String(data.get("q") ?? "").trim();
    if (nextScope) params.set("scope", nextScope);
    if (nextQuery) params.set("q", nextQuery);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/community?${qs}` : "/community", { scroll: false }));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(event.currentTarget);
  };

  const hasScopes = scopes.courses.length + scopes.batches.length > 0;

  return (
    <form ref={formRef} action="/community" method="get" role="search" onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center" aria-busy={pending || undefined}>
      {tab !== "latest" && <input type="hidden" name="tab" value={tab} />}
      {hasScopes && (
        <div className="sm:w-64">
          <label htmlFor="community-scope" className="sr-only">
            Course or batch
          </label>
          <Select
            id="community-scope"
            name="scope"
            defaultValue={scope ?? ""}
            onChange={() => {
              if (formRef.current) navigate(formRef.current);
            }}
          >
            <option value="">All courses and batches</option>
            {scopes.courses.length > 0 && (
              <optgroup label="Courses">
                {scopes.courses.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label} ({s.topicCount})
                  </option>
                ))}
              </optgroup>
            )}
            {scopes.batches.length > 0 && (
              <optgroup label="Batches">
                {scopes.batches.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label} ({s.topicCount})
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>
      )}
      <div className="flex min-w-0 flex-1 gap-2">
        <label htmlFor="community-search" className="sr-only">
          Search discussions
        </label>
        <div className="min-w-0 flex-1">
          <Input
            key={query}
            id="community-search"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={100}
            placeholder="Search questions and replies"
            leftAddon={<Icon.Search className="size-4" />}
            autoComplete="off"
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending} aria-label="Search">
          {pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
          <span className="hidden sm:inline">Search</span>
        </Button>
      </div>
    </form>
  );
}
