"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const setParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // Any filter change starts again from the first page.
    if (!("limit" in changes)) next.delete("limit");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return { params, setParams, pending };
}

/** Search box synced to `?{param}=` with a 300ms debounce. */
export function SearchParamInput({ param = "search", placeholder = "Search", label }: { param?: string; placeholder?: string; label?: string }) {
  const { params, setParams, pending } = useUrlParams();
  const urlValue = params.get(param) ?? "";
  const [value, setValue] = useState(urlValue);
  const [seenUrlValue, setSeenUrlValue] = useState(urlValue);
  const timer = useRef<number | undefined>(undefined);

  // Filters cleared elsewhere (e.g. "Clear filters") empty the box too.
  if (urlValue !== seenUrlValue) {
    setSeenUrlValue(urlValue);
    if (urlValue === "" && value.trim() !== "") setValue("");
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div className="relative w-full sm:max-w-xs">
      <Input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        leftAddon={<Icon.Search className="size-4" />}
        rightAddon={pending ? <Spinner className="size-4" /> : undefined}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setParams({ [param]: next.trim() || null }), 300);
        }}
      />
    </div>
  );
}

/** A select synced to `?{param}=`. */
export function FilterParamSelect({
  param,
  label,
  placeholder,
  options,
  className,
}: {
  param: string;
  label: string;
  placeholder: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const { params, setParams } = useUrlParams();
  const value = params.get(param) ?? "";
  return (
    <div className={cn("w-full sm:w-48", className)}>
      <Select aria-label={label} value={value} onChange={(e) => setParams({ [param]: e.target.value || null })}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** "Clear filters" link shown when any of `params` is set. */
export function ClearFiltersButton({ params: keys }: { params: string[] }) {
  const { params, setParams } = useUrlParams();
  const active = keys.some((k) => params.get(k));
  if (!active) return null;
  return (
    <Button variant="ghost" size="sm" onClick={() => setParams(Object.fromEntries(keys.map((k) => [k, null])))} leftIcon={<Icon.X className="size-4" />}>
      Clear filters
    </Button>
  );
}

/** "x of y" counter with a Load More link that raises `?limit=`. */
export function LoadMore({ shown, total, pageSize = 24 }: { shown: number; total: number; pageSize?: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (shown >= total) {
    return total > 0 ? <p className="mt-4 text-center text-xs text-ink-faint">Showing all {total}</p> : null;
  }
  const next = new URLSearchParams(params.toString());
  next.set("limit", String(shown + pageSize));
  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      <Link href={`${pathname}?${next.toString()}`} scroll={false} className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface-1 px-4 text-sm font-medium text-ink hover:bg-surface-2">
        Load More
      </Link>
      <p className="text-xs text-ink-faint">
        {shown} of {total}
      </p>
    </div>
  );
}

/** Banner shown above a table while rows are selected. */
export function SelectionBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/6 px-4 py-2 animate-fade-in" role="region" aria-label="Selection actions">
      <p className="text-sm font-medium text-ink">
        {count} selected
        <button type="button" onClick={onClear} className="ml-3 text-xs font-normal text-ink-muted hover:text-ink hover:underline">
          Clear selection
        </button>
      </p>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Tri-state "select all" checkbox. */
export function SelectAllCheckbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate: boolean; onChange: () => void; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      onChange={onChange}
      className="size-4 cursor-pointer accent-accent"
    />
  );
}
