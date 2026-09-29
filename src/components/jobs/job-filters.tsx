"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { jobTypes } from "@/lib/config";
import { Input, Select } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { WORK_MODES } from "./work-mode";

export interface JobFilterValues {
  status: "open" | "closed";
  search: string;
  type: string;
  mode: string;
  country: string;
}

function buildQuery(v: JobFilterValues): string {
  const qs = new URLSearchParams();
  if (v.status === "closed") qs.set("status", "closed");
  if (v.search.trim()) qs.set("search", v.search.trim());
  if (v.type) qs.set("type", v.type);
  if (v.mode) qs.set("mode", v.mode);
  if (v.country) qs.set("country", v.country);
  return qs.toString();
}

/**
 * Open/Closed tabs + search, country, type and work mode filters (URL-driven).
 * The Country filter is only offered to signed-in members (`countries` is
 * null for guests), matching the reference board.
 */
export function JobFilters({
  values,
  showClosedTab,
  openCount,
  closedCount,
  countries,
}: {
  values: JobFilterValues;
  showClosedTab: boolean;
  openCount?: number;
  closedCount?: number;
  countries: string[] | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(values.search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const go = (next: Partial<JobFilterValues>) => {
    const query = buildQuery({ ...values, search, ...next });
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  const tabHref = (status: "open" | "closed") => {
    const query = buildQuery({ ...values, status });
    return query ? `${pathname}?${query}` : pathname;
  };

  return (
    <div className="space-y-3">
      {showClosedTab && (
        <div role="tablist" aria-label="Job status" className="inline-flex rounded-lg bg-surface-2 p-0.5">
          {(["open", "closed"] as const).map((s) => {
            const active = values.status === s;
            const count = s === "open" ? openCount : closedCount;
            return (
              <Link
                key={s}
                role="tab"
                aria-selected={active}
                href={tabHref(s)}
                scroll={false}
                className={cn("rounded-md px-3 py-1 text-sm font-medium transition-colors", active ? "bg-surface-1 text-ink shadow-sm" : "text-ink-muted hover:text-ink")}
              >
                {s === "open" ? "Open" : "Closed"}
                {count !== undefined && <span className="ml-1.5 text-xs text-ink-faint">{count}</span>}
              </Link>
            );
          })}
        </div>
      )}
      <div
        className={cn("grid gap-2 sm:grid-cols-2", countries ? "lg:grid-cols-[minmax(0,1fr)_11rem_11rem_11rem]" : "lg:grid-cols-[minmax(0,1fr)_11rem_11rem]")}
        aria-busy={pending}
      >
        <div className="sm:col-span-2 lg:col-span-1">
          <Input
            type="search"
            aria-label="Search jobs"
            placeholder="Search by title, company or location"
            value={search}
            onChange={(e) => {
              const value = e.target.value;
              setSearch(value);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => go({ search: value }), 300);
            }}
            leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
          />
        </div>
        {countries && (
          <Select aria-label="Country" value={values.country} onChange={(e) => go({ country: e.target.value })}>
            <option value="">Any country</option>
            {values.country && !countries.includes(values.country) && <option value={values.country}>{values.country}</option>}
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label="Type" value={values.type} onChange={(e) => go({ type: e.target.value })}>
          <option value="">All types</option>
          {jobTypes.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Work Mode" value={values.mode} onChange={(e) => go({ mode: e.target.value })}>
          <option value="">Any work mode</option>
          {WORK_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
