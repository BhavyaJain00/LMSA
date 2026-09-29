"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";

export interface OutboxFilterValues {
  status: string;
  category: string;
  q: string;
}

/** Search (recipient/subject) + category filter; status comes from the tabs. Resets to page 1. */
export function OutboxFilters({ values, categories }: { values: OutboxFilterValues; categories: { value: string; label: string; count: number }[] }) {
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

  const apply = (next: Partial<OutboxFilterValues>) => {
    const merged = { ...values, q, ...next };
    const qs = new URLSearchParams();
    if (merged.status && merged.status !== "all") qs.set("status", merged.status);
    if (merged.category && merged.category !== "all") qs.set("category", merged.category);
    if (merged.q.trim()) qs.set("q", merged.q.trim());
    const query = qs.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]" aria-busy={pending}>
      <Input
        type="search"
        aria-label="Search emails"
        placeholder="Search by recipient or subject"
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
        aria-label="Filter by category"
        value={values.category}
        onChange={(e) => apply({ category: e.target.value })}
        options={[{ value: "all", label: "All categories" }, ...categories.map((c) => ({ value: c.value, label: `${c.label} (${c.count})` }))]}
      />
    </div>
  );
}
