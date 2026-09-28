"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";

export interface MemberFilterValues {
  search: string;
  role: string;
  status: string;
}

/** URL-driven search + role + enabled filters for the members list. */
export function MembersFilters({ values }: { values: MemberFilterValues }) {
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
        aria-label="Search members"
        placeholder="Search by name, email or username"
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
        aria-label="Filter by role"
        value={values.role}
        onChange={(e) => apply({ role: e.target.value })}
        options={[
          { value: "all", label: "All roles" },
          { value: "student", label: "Student" },
          { value: "course_creator", label: "Course Creator" },
          { value: "batch_evaluator", label: "Evaluator" },
          { value: "moderator", label: "Moderator" },
          { value: "admin", label: "Admin" },
        ]}
      />
      <Select
        aria-label="Filter by status"
        value={values.status}
        onChange={(e) => apply({ status: e.target.value })}
        options={[
          { value: "all", label: "Any status" },
          { value: "enabled", label: "Enabled" },
          { value: "disabled", label: "Disabled" },
        ]}
      />
    </div>
  );
}
