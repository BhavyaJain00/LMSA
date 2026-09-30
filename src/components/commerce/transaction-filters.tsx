"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icons";

export interface TransactionFilterValues {
  status: string;
  type: string;
  from: string;
  to: string;
  search: string;
}

const EMPTY: TransactionFilterValues = { status: "all", type: "all", from: "", to: "", search: "" };

/** URL-driven filters for the transactions table (status, type, date range, search). */
export function TransactionFilters({ values }: { values: TransactionFilterValues }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(values.search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (next: Partial<TransactionFilterValues>) => {
    const merged = { ...values, search, ...next };
    const qs = new URLSearchParams();
    if (merged.status !== "all") qs.set("status", merged.status);
    if (merged.type !== "all") qs.set("type", merged.type);
    if (merged.from) qs.set("from", merged.from);
    if (merged.to) qs.set("to", merged.to);
    if (merged.search.trim()) qs.set("search", merged.search.trim());
    const query = qs.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onSearch = (value: string) => {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ search: value }), 300);
  };

  const hasFilters = values.status !== "all" || values.type !== "all" || !!values.from || !!values.to || !!values.search;

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" aria-busy={pending}>
      <Input
        type="search"
        aria-label="Search transactions"
        placeholder="Search name, email or order ID"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
      />
      <Select
        aria-label="Filter by status"
        value={values.status}
        onChange={(e) => apply({ status: e.target.value })}
        options={[
          { value: "all", label: "All Payments" },
          { value: "paid", label: "Paid" },
          { value: "pending", label: "Unpaid (pending)" },
          { value: "failed", label: "Cancelled / failed" },
          { value: "refunded", label: "Refunded" },
        ]}
      />
      <Select
        aria-label="Filter by type"
        value={values.type}
        onChange={(e) => apply({ type: e.target.value })}
        options={[
          { value: "all", label: "All types" },
          { value: "course", label: "For Course" },
          { value: "batch", label: "For Batch" },
          { value: "certificate", label: "For Certificate" },
          { value: "plan", label: "For Membership" },
          { value: "bundle", label: "For Bundle" },
        ]}
      />
      <Input type="date" aria-label="From date" value={values.from} max={values.to || undefined} onChange={(e) => apply({ from: e.target.value })} />
      <Input type="date" aria-label="To date" value={values.to} min={values.from || undefined} onChange={(e) => apply({ to: e.target.value })} />
      <Button
        variant="ghost"
        disabled={!hasFilters}
        onClick={() => {
          setSearch("");
          apply(EMPTY);
        }}
      >
        Clear
      </Button>
    </div>
  );
}
