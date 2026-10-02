"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Input, Select } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/icons";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAGE_SIZES } from "./shared";
import { useT } from "@/i18n/client";

export interface FilterDef {
  /** Query-string key. */
  param: string;
  /** "toggle" renders a chip that sets the param to "true" while pressed. */
  kind: "search" | "select" | "toggle";
  label: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** Locked filters are shown but cannot be changed. */
  disabled?: boolean;
  className?: string;
  /** Toggle chips: tone of the leading dot while pressed. */
  tone?: "success" | "accent" | "info" | "warning";
}

const TOGGLE_TONES: Record<NonNullable<FilterDef["tone"]>, string> = {
  success: "bg-success",
  accent: "bg-accent",
  info: "bg-info",
  warning: "bg-warning",
};

function ToggleFilter({ def, pressed, onToggle }: { def: FilterDef; pressed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={def.disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex h-9 items-center gap-2 self-start rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto",
        pressed ? "border-accent/40 bg-accent/10 text-ink" : "border-border bg-surface-1 text-ink-muted hover:border-border-strong hover:text-ink",
        def.className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full transition-colors", pressed ? TOGGLE_TONES[def.tone ?? "accent"] : "bg-border-strong")}
      />
      {def.label}
      {pressed && <Icon.Check className="size-3.5 text-accent" />}
    </button>
  );
}

function useQueryUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const update = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    // Changing a filter resets pagination.
    if (!("pages" in changes)) params.delete("pages");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return { update, pending, search };
}

function SearchFilter({ def, initial, onCommit }: { def: FilterDef; initial: string; onCommit: (value: string) => void }) {
  const tc = useT("common");
  const [value, setValue] = useState(initial);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className={cn("w-full sm:w-64", def.className)}>
      <label className="sr-only" htmlFor={`filter-${def.param}`}>
        {def.label}
      </label>
      <Input
        id={`filter-${def.param}`}
        type="search"
        value={value}
        placeholder={def.placeholder ?? tc("actions.search")}
        disabled={def.disabled}
        leftAddon={<Icon.Search className="size-4" />}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => onCommit(next.trim()), 300);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (timer.current) window.clearTimeout(timer.current);
            onCommit(value.trim());
          }
        }}
      />
    </div>
  );
}

/** Filter row whose values live in the URL (so filters are shareable and restored on reload). */
export function FilterBar({ filters, children, className }: { filters: FilterDef[]; children?: ReactNode; className?: string }) {
  const t = useT("learning");
  const { update, pending, search } = useQueryUpdater();
  // Bumped by "Clear filters" to remount search inputs with an empty value.
  const [resetKey, setResetKey] = useState(0);
  const active = filters.some((f) => !f.disabled && search.get(f.param));
  return (
    <div className={cn("mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center", className)}>
      {filters.map((def) =>
        def.kind === "toggle" ? (
          <ToggleFilter
            key={def.param}
            def={def}
            pressed={search.get(def.param) === "true"}
            onToggle={() => update({ [def.param]: search.get(def.param) === "true" ? null : "true" })}
          />
        ) : def.kind === "search" ? (
          <SearchFilter
            key={`${def.param}-${resetKey}`}
            def={def}
            initial={search.get(def.param) ?? ""}
            onCommit={(v) => {
              if ((search.get(def.param) ?? "") !== v) update({ [def.param]: v || null });
            }}
          />
        ) : (
          <div key={def.param} className={cn("w-full sm:w-52", def.className)}>
            <label className="sr-only" htmlFor={`filter-${def.param}`}>
              {def.label}
            </label>
            <Select
              id={`filter-${def.param}`}
              value={search.get(def.param) ?? ""}
              disabled={def.disabled}
              onChange={(e) => update({ [def.param]: e.target.value || null })}
            >
              <option value="">{def.placeholder ?? t("global.lists.all", { label: def.label.toLowerCase() })}</option>
              {def.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        ),
      )}
      {active && (
        <button
          type="button"
          onClick={() => {
            setResetKey((k) => k + 1);
            update(Object.fromEntries(filters.filter((f) => !f.disabled).map((f) => [f.param, null])));
          }}
          className={buttonClasses({ variant: "ghost", size: "sm", className: "self-start sm:self-auto" })}
        >
          <Icon.X className="size-4" />
          {t("global.lists.clearFilters")}
        </button>
      )}
      {pending && <Spinner className="size-4 text-ink-faint" />}
      {children}
    </div>
  );
}

/** "Showing x of y" + page-length selector + Load More (URL params ?size= and ?pages=). */
export function ListFooter({ shown, total, size, pages, noun }: { shown: number; total: number; size: number; pages: number; noun?: string }) {
  const t = useT("learning");
  const tc = useT("common");
  const { update, pending, search } = useQueryUpdater();
  if (total === 0) return null;
  const params = new URLSearchParams(search.toString());
  params.set("pages", String(pages + 1));
  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-3 text-sm text-ink-muted sm:flex-row">
      <p>{noun ? t("global.lists.showingNoun", { shown, total, noun }) : t("global.lists.showing", { shown, total })}</p>
      <div className="flex items-center gap-2">
        <label htmlFor="page-size" className="text-xs">
          {t("global.lists.perPage")}
        </label>
        <div className="w-24">
          <Select id="page-size" value={String(size)} onChange={(e) => update({ size: e.target.value, pages: null })} className="h-8 text-xs">
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        {shown < total && (
          <Link href={`?${params.toString()}`} scroll={false} className={buttonClasses({ variant: "outline", size: "sm" })} aria-busy={pending || undefined}>
            {tc("actions.loadMore")}
          </Link>
        )}
      </div>
    </div>
  );
}
