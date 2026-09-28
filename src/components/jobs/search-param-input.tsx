"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";

/** Debounced search box that writes `?search=` while keeping other query params. */
export function SearchParamInput({ placeholder = "Search", label, param = "search" }: { placeholder?: string; label: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get(param) ?? "");
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const push = (next: string) => {
    const qs = new URLSearchParams(params.toString());
    if (next.trim()) qs.set(param, next.trim());
    else qs.delete(param);
    const query = qs.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  return (
    <Input
      type="search"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => push(next), 300);
      }}
      leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
    />
  );
}
