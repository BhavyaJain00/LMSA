"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";

export interface LoginEventFilterValues {
  q: string;
  outcome: string;
  reason: string;
  period: string;
}

/** URL-driven filters for the admin login activity table. */
export function LoginEventsFilters({ values, reasons, userId }: { values: LoginEventFilterValues; reasons: { value: string; label: string }[]; userId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(values.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const apply = (patch: Partial<LoginEventFilterValues>) => {
    const merged = { ...values, q, ...patch };
    const qs = new URLSearchParams();
    if (merged.q.trim()) qs.set("q", merged.q.trim());
    if (merged.outcome !== "all") qs.set("outcome", merged.outcome);
    if (merged.reason !== "all") qs.set("reason", merged.reason);
    if (merged.period !== "30d") qs.set("period", merged.period);
    if (userId) qs.set("user", userId);
    const query = qs.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9rem_14rem_9rem]" aria-busy={pending}>
      <Input
        type="search"
        aria-label="Search by email, name or IP address"
        placeholder="Search email, name or IP"
        value={q}
        onChange={(e) => {
          const value = e.target.value;
          setQ(value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => apply({ q: value }), 350);
        }}
        leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
      />
      <Select
        aria-label="Filter by outcome"
        value={values.outcome}
        onChange={(e) => apply({ outcome: e.target.value })}
        options={[
          { value: "all", label: "Any outcome" },
          { value: "success", label: "Signed in" },
          { value: "failure", label: "Failed or blocked" },
        ]}
      />
      <Select aria-label="Filter by reason" value={values.reason} onChange={(e) => apply({ reason: e.target.value })} options={[{ value: "all", label: "Any reason" }, ...reasons]} />
      <Select
        aria-label="Time period"
        value={values.period}
        onChange={(e) => apply({ period: e.target.value })}
        options={[
          { value: "24h", label: "Last 24 hours" },
          { value: "7d", label: "Last 7 days" },
          { value: "30d", label: "Last 30 days" },
          { value: "all", label: "All time" },
        ]}
      />
    </div>
  );
}
