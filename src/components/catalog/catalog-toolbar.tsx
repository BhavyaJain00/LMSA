"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon, Spinner } from "@/components/ui/icons";
import { Checkbox, Field, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

export interface CatalogToolbarProps {
  categories: { slug: string; name: string; courseCount: number }[];
  sorts: { value: string; label: string }[];
  category: string;
  sort: string;
  certification: boolean;
  /** Whether the certification filter is offered (certificates feature on). */
  showCertification: boolean;
  /** Show only free courses (`?price=free`). */
  freeOnly?: boolean;
}

type Updates = Record<string, string | null>;

/**
 * Catalog search + filters. Every change rewrites the URL query in place
 * (`?search=&category=&sort=&certification=`) so results are shareable and
 * rendered on the server; the page is reset to the first "load more" page.
 */
export function CatalogToolbar({ categories, sorts, category, sort, certification, showCertification, freeOnly = false }: CatalogToolbarProps) {
  const t = useT("public");
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
  // Search values this toolbar has pushed to the URL that have not committed yet, oldest first.
  const [ownSearches, setOwnSearches] = useState<string[]>([]);
  // Keep the input in sync when the search changes from elsewhere (e.g. the header search box).
  // URL updates caused by our own debounced navigation are ignored: they commit after a server
  // round-trip, by which time the user may have typed more, and copying the older value back
  // would overwrite (and then drop) those keystrokes.
  if (urlSearch !== syncedSearch) {
    setSyncedSearch(urlSearch);
    const own = ownSearches.lastIndexOf(urlSearch);
    if (own === -1) {
      if (ownSearches.length) setOwnSearches([]);
      if (urlSearch.trim() !== query.trim()) setQuery(urlSearch);
    } else {
      setOwnSearches(ownSearches.slice(own + 1));
    }
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const apply = (updates: Updates) => {
    // Read the live URL so a debounced search never overwrites a filter picked meanwhile.
    const params = new URLSearchParams(window.location.search);
    const currentSearch = params.get("search") ?? params.get("title") ?? "";
    if ("search" in updates) {
      const next = updates.search ?? "";
      if (next !== currentSearch) setOwnSearches((prev) => [...prev, next].slice(-20));
    }
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

  const activeFilters = (category ? 1 : 0) + (certification ? 1 : 0) + (freeOnly ? 1 : 0) + (sort !== "newest" ? 1 : 0);

  const categorySelect = (id: string) => (
    <Select
      id={id}
      aria-label={t("catalog.filters.category")}
      value={category}
      onChange={(e) => apply({ category: e.target.value || null })}
      className="sm:w-48"
    >
      <option value="">{t("catalog.filters.allCategories")}</option>
      {categories.map((c) => (
        <option key={c.slug} value={c.slug}>
          {t("catalog.filters.categoryOption", { name: c.name, count: c.courseCount })}
        </option>
      ))}
    </Select>
  );

  const sortSelect = (id: string) => (
    <Select id={id} aria-label={t("catalog.filters.sortBy")} value={sort} onChange={(e) => apply({ sort: e.target.value === "newest" ? null : e.target.value })} className="sm:w-44">
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
          {t("catalog.search.label")}
        </label>
        <Icon.Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
        <input
          ref={inputRef}
          id="catalog-search"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("catalog.search.placeholder")}
          autoComplete="off"
          className="h-10 w-full rounded-lg border border-border-strong bg-surface-1 ps-9 pe-10 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <span className="absolute end-3 top-1/2 flex -translate-y-1/2 items-center">
          {pending ? (
            <Spinner className="size-4 text-ink-faint" />
          ) : query ? (
            <button
              type="button"
              aria-label={t("catalog.search.clear")}
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
        <label
          className={cn(
            "inline-flex h-9.5 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition-colors",
            freeOnly ? "border-accent bg-accent/5 text-ink" : "border-border-strong bg-surface-1 text-ink-muted hover:bg-surface-2",
          )}
        >
          <input type="checkbox" checked={freeOnly} onChange={(e) => apply({ price: e.target.checked ? "free" : null })} className="size-4 cursor-pointer accent-accent" />
          <Icon.Gift className="size-4" aria-hidden="true" />
          {t("catalog.filters.freeOnly")}
        </label>
        {showCertification && (
          <label
            className={cn(
              "inline-flex h-9.5 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition-colors",
              certification ? "border-accent bg-accent/5 text-ink" : "border-border-strong bg-surface-1 text-ink-muted hover:bg-surface-2",
            )}
            title={t("catalog.filters.certificationHint")}
          >
            <input
              type="checkbox"
              checked={certification}
              onChange={(e) => apply({ certification: e.target.checked ? "true" : null })}
              className="size-4 cursor-pointer accent-accent"
            />
            <Icon.GraduationCap className="size-4" aria-hidden="true" />
            {t("catalog.filters.certification")}
          </label>
        )}
      </div>

      {/* Mobile: filters in a sheet */}
      <div className="flex items-center gap-2 sm:hidden">
        <Button variant="outline" className="flex-1" onClick={() => setSheetOpen(true)} leftIcon={<Icon.Filter className="size-4" />}>
          {t("catalog.filters.title")}
          {activeFilters > 0 && (
            <span className="ms-1 inline-flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg">{activeFilters}</span>
          )}
        </Button>
      </div>
      <Dialog open={sheetOpen} onClose={() => setSheetOpen(false)} title={t("catalog.filters.title")} size="sm">
        <div className="space-y-4">
          {categories.length > 0 && (
            <Field label={t("catalog.filters.category")} htmlFor="catalog-category-mobile">
              {categorySelect("catalog-category-mobile")}
            </Field>
          )}
          <Field label={t("catalog.filters.sortBy")} htmlFor="catalog-sort-mobile">
            {sortSelect("catalog-sort-mobile")}
          </Field>
          <Checkbox id="catalog-free-mobile" label={t("catalog.filters.freeOnly")} checked={freeOnly} onChange={(e) => apply({ price: e.target.checked ? "free" : null })} />
          {showCertification && (
            <Checkbox
              id="catalog-certification-mobile"
              label={t("catalog.filters.certificationAvailable")}
              description={t("catalog.filters.certificationHint")}
              checked={certification}
              onChange={(e) => apply({ certification: e.target.checked ? "true" : null })}
            />
          )}
          <div className="flex gap-2 border-t border-border pt-4">
            <Button
              variant="outline"
              className="flex-1"
              disabled={activeFilters === 0}
              onClick={() => apply({ category: null, sort: null, certification: null, price: null })}
            >
              {t("catalog.filters.reset")}
            </Button>
            <Button className="flex-1" onClick={() => setSheetOpen(false)} loading={pending}>
              {t("catalog.filters.showResults")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
