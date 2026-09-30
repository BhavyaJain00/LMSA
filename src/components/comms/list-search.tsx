"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export interface ListSelectFilter {
  /** Query parameter the select writes. */
  param: string;
  label: string;
  /** The first option is the default and is left out of the URL. */
  options: { value: string; label: string }[];
}

/**
 * Search box (and an optional select) for the broadcast and sequence lists.
 * The values live in the URL; every change goes back to page 1 and keeps the
 * other query parameters (e.g. the status tab).
 */
export function ListSearch({
  label,
  placeholder,
  param = "q",
  pageParam = "page",
  select,
  className,
}: {
  label: string;
  placeholder: string;
  param?: string;
  pageParam?: string;
  select?: ListSelectFilter;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(search.get(param) ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const apply = (key: string, value: string, isDefault: boolean) => {
    const qs = new URLSearchParams(search.toString());
    if (isDefault) qs.delete(key);
    else qs.set(key, value);
    qs.delete(pageParam);
    const query = qs.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  const selectValue = select ? (search.get(select.param) ?? select.options[0]?.value ?? "") : "";

  return (
    <div className={cn("grid gap-2", select && "sm:grid-cols-[minmax(0,1fr)_12rem]", className)} aria-busy={pending}>
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={q}
        maxLength={120}
        onChange={(e) => {
          const value = e.target.value;
          setQ(value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => apply(param, value.trim(), !value.trim()), 300);
        }}
        leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
      />
      {select && (
        <Select
          aria-label={select.label}
          value={selectValue}
          onChange={(e) => apply(select.param, e.target.value, e.target.value === select.options[0]?.value)}
          options={select.options}
        />
      )}
    </div>
  );
}
