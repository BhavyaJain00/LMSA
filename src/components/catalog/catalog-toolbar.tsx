"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon, Spinner } from "@/components/ui/icons";
import { Checkbox, Field, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface CatalogToolbarProps {
  categories: { slug: string; name: string; courseCount: number }[];
  sorts: { value: string; label: string }[];
  category: string;
  sort: string;
  certification: boolean;
  /** Whether the certification filter is offered (certificates feature on). */
  showCertification: boolean;
}

type Updates = Record<string, string | null>;

/**
 * Catalog search + filters. Every change rewrites the URL query in place
 * (`?search=&category=&sort=&certification=`) so results are shareable and
 * rendered on the server; the page is reset to the first "load more" page.
 */
export function CatalogToolbar({ categories, sorts, category, sort, certification, showCertification }: CatalogToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const urlSearch = searchParams.get("search") ?? searchParams.get("title") ?? "";
  const [query, setQuery] = useState(urlSearch);
  const [syncedSearch, setSyncedSearch] = useState(urlSearch);
  // Keep the input in sync when the search changes from elsewhere (e.g. the header search box).
  if (urlSearch !== syncedSearch) {
    setSyncedSearch(urlSearch);
    if (urlSearch.trim() !== query.trim()) setQuery(urlSearch);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const apply = (updates: Updates) => {
    // Read the live URL so a debounced search never overwrites a filter picked meanwhile.
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    if ("search" in updates) params.delete("title");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ search: value.trim() || null }), 350);
  };

  const submitSearch = () => {
    if (timer.current) clearTimeout(timer.current);
    apply({ search: query.trim() || null });
  };

  const activeFilters = (category ? 1 : 0) + (certification ? 1 : 0) + (sort !== "newest" ? 1 : 0);

  const categorySelect = (id: string) => (
    <Select
      id={id}
      aria-label="Category"
      value={category}
      onChange={(e) => apply({ category: e.target.value || null })}
      className="sm:w-48"
    >
      <option value="">All categories</option>
      {categories.map((c) => (
        <option key={c.slug} value={c.slug}>
          {c.name} ({c.courseCount})
        </option>
      ))}
    </Select>
  );

  const sortSelect = (id: string) => (
    <Select id={id} aria-label="Sort by" value={sort} onChange={(e) => apply({ sort: e.target.value === "newest" ? null : e.target.value })} className="sm:w-44">
      {sorts.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </Select>
  );

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <form
        role="search"
        className="relative min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          submitSearch();
        }}
      >
        <label htmlFor="catalog-search" className="sr-only">
          Search courses
        </label>
        <Icon.Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
        <input
          ref={inputRef}
          id="catalog-search"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search by title, topic, tag or instructor"
          autoComplete="off"
          className="h-10 w-full rounded-lg border border-border-strong bg-surface-1 pl-9 pr-10 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center">
          {pending ? (
            <Spinner className="size-4 text-ink-faint" />
          ) : query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                if (timer.current) clearTimeout(timer.current);
                apply({ search: null });
                inputRef.current?.focus();
              }}
              className="rounded p-0.5 text-ink-faint hover:text-ink"
            >
              <Icon.X className="size-4" />
            </button>
          ) : null}
        </span>
      </form>

      {/* Desktop / tablet filters */}
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        {categories.length > 0 && categorySelect("catalog-category")}
        {sortSelect("catalog-sort")}
        {showCertification && (
          <label
            className={cn(
              "inline-flex h-9.5 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition-colors",
              certification ? "border-accent bg-accent/5 text-ink" : "border-border-strong bg-surface-1 text-ink-muted hover:bg-surface-2",
            )}
            title="Only show courses that offer a certificate"
          >
            <input
              type="checkbox"
              checked={certification}
              onChange={(e) => apply({ certification: e.target.checked ? "true" : null })}
              className="size-4 cursor-pointer accent-accent"
            />
            <Icon.GraduationCap className="size-4" aria-hidden="true" />
            Certification
          </label>
        )}
      </div>

      {/* Mobile: filters in a sheet */}
      <div className="flex items-center gap-2 sm:hidden">
        <Button variant="outline" className="flex-1" onClick={() => setSheetOpen(true)} leftIcon={<Icon.Filter className="size-4" />}>
          Filters
          {activeFilters > 0 && (
            <span className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg">{activeFilters}</span>
          )}
        </Button>
      </div>
      <Dialog open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filters" size="sm">
        <div className="space-y-4">
          {categories.length > 0 && (
            <Field label="Category" htmlFor="catalog-category-mobile">
              {categorySelect("catalog-category-mobile")}
            </Field>
          )}
          <Field label="Sort by" htmlFor="catalog-sort-mobile">
            {sortSelect("catalog-sort-mobile")}
          </Field>
          {showCertification && (
            <Checkbox
              id="catalog-certification-mobile"
              label="Certification available"
              description="Only show courses that offer a certificate"
              checked={certification}
              onChange={(e) => apply({ certification: e.target.checked ? "true" : null })}
            />
          )}
          <div className="flex gap-2 border-t border-border pt-4">
            <Button
              variant="outline"
              className="flex-1"
              disabled={activeFilters === 0}
              onClick={() => apply({ category: null, sort: null, certification: null })}
            >
              Reset
            </Button>
            <Button className="flex-1" onClick={() => setSheetOpen(false)} loading={pending}>
              Show results
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
