"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

export interface MemberFilterValues {
  search: string;
  role: string;
  status: string;
}

/** URL-driven search + role + enabled filters for the members list. */
export function MembersFilters({ values }: { values: MemberFilterValues }) {
  const t = useT("admin");
  const ts = useT("shell");
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

  const apply = (next: Partial<MemberFilterValues>) => {
    const merged = { ...values, search, ...next };
    const qs = new URLSearchParams();
    if (merged.search.trim()) qs.set("search", merged.search.trim());
    if (merged.role !== "all") qs.set("role", merged.role);
    if (merged.status !== "all") qs.set("status", merged.status);
    const query = qs.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_10rem]" aria-busy={pending}>
      <Input
        type="search"
        aria-label={t("members.filters.searchLabel")}
        placeholder={t("members.filters.searchPlaceholder")}
        value={search}
        onChange={(e) => {
          const value = e.target.value;
          setSearch(value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => apply({ search: value }), 300);
        }}
        leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
      />
      <Select
        aria-label={t("members.filters.role")}
        value={values.role}
        onChange={(e) => apply({ role: e.target.value })}
        options={[
          { value: "all", label: t("members.filters.allRoles") },
          { value: "student", label: ts("roles.student") },
          { value: "course_creator", label: ts("roles.course_creator") },
          { value: "batch_evaluator", label: ts("roles.batch_evaluator") },
          { value: "moderator", label: ts("roles.moderator") },
          { value: "admin", label: ts("roles.admin") },
        ]}
      />
      <Select
        aria-label={t("members.filters.status")}
        value={values.status}
        onChange={(e) => apply({ status: e.target.value })}
        options={[
          { value: "all", label: t("members.filters.anyStatus") },
          { value: "enabled", label: t("members.filters.enabled") },
          { value: "disabled", label: t("members.filters.disabled") },
        ]}
      />
    </div>
  );
}
