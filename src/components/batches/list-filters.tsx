"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Input, Select } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

/**
 * URL-driven list filters: text search (debounced), optional category select
 * and an optional "Certification" toggle. Other query params (e.g. `tab`) are kept.
 */
export function ListFilters({
  categories,
  certification = false,
  certificationHint,
  placeholder,
  className,
}: {
  categories?: { value: string; label: string }[];
  certification?: boolean;
  /** Tooltip of the certification toggle (defaults to a generic hint). */
  certificationHint?: string;
  placeholder?: string;
  className?: string;
}) {
  // `global.` keys: the filters are also used on admin list pages.
  const t = useT("public");
  const searchLabel = placeholder ?? t("global.listFilters.search");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const onSearch = (value: string) => {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ search: value.trim() || null }), 300);
  };

  const category = params.get("category") ?? "";
  const certOnly = params.get("certification") === "1";
  const activeCount = (category ? 1 : 0) + (certOnly ? 1 : 0) + (search.trim() ? 1 : 0);

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center", className)} role="search">
      <div className="sm:w-60">
        <label htmlFor="list-search" className="sr-only">
          {searchLabel}
        </label>
        <Input
          id="list-search"
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchLabel}
          leftAddon={<Icon.Search className="size-4" />}
          rightAddon={pending ? <Spinner className="size-4" /> : undefined}
        />
      </div>
      {categories && categories.length > 0 && (
        <div className="sm:w-48">
          <label htmlFor="list-category" className="sr-only">
            {t("global.listFilters.category")}
          </label>
          <Select id="list-category" value={category} onChange={(e) => apply({ category: e.target.value || null })}>
            <option value="">{t("global.listFilters.allCategories")}</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
      )}
      {certification && (
        <button
          type="button"
          aria-pressed={certOnly}
          title={certificationHint ?? t("global.listFilters.certificationHint")}
          onClick={() => apply({ certification: certOnly ? null : "1" })}
          className={cn(
            "inline-flex h-9.5 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
            certOnly ? "border-accent bg-accent/10 text-accent" : "border-border-strong bg-surface-1 text-ink-muted hover:bg-surface-2 hover:text-ink",
          )}
        >
          <Icon.Award className="size-4" />
          {t("global.listFilters.certification")}
        </button>
      )}
      {activeCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setSearch("");
            apply({ search: null, category: null, certification: null });
          }}
          className="inline-flex h-9.5 items-center gap-1 self-start rounded-lg px-2 text-sm text-ink-muted hover:text-ink sm:self-auto"
        >
          <Icon.X className="size-4" /> {t("global.listFilters.clear")}
        </button>
      )}
    </div>
  );
}
