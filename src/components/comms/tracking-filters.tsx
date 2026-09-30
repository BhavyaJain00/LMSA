"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";

export interface TrackingFilterValues {
  range: number;
  type: "all" | "open" | "click";
  q: string;
}

const RANGE_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

/** Period, event type and search for the tracking page. Every change goes back to page 1. */
export function TrackingFilters({ values }: { values: TrackingFilterValues }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(values.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const apply = (next: Partial<TrackingFilterValues>) => {
    const merged = { ...values, q, ...next };
    const qs = new URLSearchParams();
    if (merged.range !== 30) qs.set("range", String(merged.range));
    if (merged.type !== "all") qs.set("type", merged.type);
    if (merged.q.trim()) qs.set("q", merged.q.trim());
    const query = qs.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_11rem]" aria-busy={pending}>
      <Input
        type="search"
        aria-label="Search events"
        placeholder="Search by recipient, subject or link"
        value={q}
        onChange={(e) => {
          const value = e.target.value;
          setQ(value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => apply({ q: value }), 300);
        }}
        leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
      />
      <Select
        aria-label="Event type"
        value={values.type}
        onChange={(e) => apply({ type: e.target.value as TrackingFilterValues["type"] })}
        options={[
          { value: "all", label: "Opens and clicks" },
          { value: "open", label: "Opens" },
          { value: "click", label: "Clicks" },
        ]}
      />
      <Select aria-label="Period" value={String(values.range)} onChange={(e) => apply({ range: Number(e.target.value) })} options={RANGE_OPTIONS} />
    </div>
  );
}
