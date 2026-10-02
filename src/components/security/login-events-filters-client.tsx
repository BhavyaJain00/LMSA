"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

export interface LoginEventFilterValues {
  q: string;
  outcome: string;
  reason: string;
  period: string;
}

/** URL-driven filters for the admin login activity table. Rendered through `LoginEventsFilters`, which provides its messages. */
export function LoginEventsFiltersClient({ values, reasons, userId }: { values: LoginEventFilterValues; reasons: { value: string; label: string }[]; userId?: string }) {
  const router = useRouter();
  const t = useT("account");
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
        aria-label={t("security.filters.searchLabel")}
        placeholder={t("security.filters.searchPlaceholder")}
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
        aria-label={t("security.filters.outcome")}
        value={values.outcome}
        onChange={(e) => apply({ outcome: e.target.value })}
        options={[
          { value: "all", label: t("security.filters.anyOutcome") },
          { value: "success", label: t("security.filters.success") },
          { value: "failure", label: t("security.filters.failure") },
        ]}
      />
      <Select
        aria-label={t("security.filters.reason")}
        value={values.reason}
        onChange={(e) => apply({ reason: e.target.value })}
        options={[{ value: "all", label: t("security.filters.anyReason") }, ...reasons]}
      />
      <Select
        aria-label={t("security.filters.period")}
        value={values.period}
        onChange={(e) => apply({ period: e.target.value })}
        options={[
          { value: "24h", label: t("security.filters.last24h") },
          { value: "7d", label: t("security.filters.last7d") },
          { value: "30d", label: t("security.filters.last30d") },
          { value: "all", label: t("security.filters.allTime") },
        ]}
      />
    </div>
  );
}
