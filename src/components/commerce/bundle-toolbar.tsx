"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";
import { BUNDLE_SORT_LABELS, type BundleSort } from "@/lib/commerce/bundles";

const SORTS = Object.entries(BUNDLE_SORT_LABELS).map(([value, label]) => ({ value, label }));

/**
 * Search and sort of the bundles index. Both live in the URL (`?q=&sort=`),
 * so results are rendered on the server and can be shared; a change goes back
 * to the first page. The form also submits without JavaScript.
 */
export function BundleToolbar({ q, sort }: { q: string; sort: BundleSort }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const apply = (next: { q?: string; sort?: string }) => {
    const query = new URLSearchParams();
    const text = (next.q ?? search).trim();
    const order = next.sort ?? sort;
    if (text) query.set("q", text);
    if (order !== "newest") query.set("sort", order);
    startTransition(() => router.replace(query.size ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  const onSearch = (value: string) => {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ q: value }), 300);
  };

  return (
    <form
      role="search"
      method="get"
      aria-label="Search bundles"
      aria-busy={pending}
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        apply({});
      }}
    >
      <div className="min-w-0 flex-1">
        <Input
          type="search"
          name="q"
          aria-label="Search bundles"
          placeholder="Search bundles or the courses inside them"
          value={search}
          maxLength={100}
          onChange={(e) => onSearch(e.target.value)}
          leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
        />
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 sm:w-52 sm:flex-none">
          <Select name="sort" aria-label="Sort bundles" value={sort} onChange={(e) => apply({ sort: e.target.value })} options={SORTS} />
        </div>
        {(q || sort !== "newest") && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current);
              setSearch("");
              apply({ q: "", sort: "newest" });
            }}
          >
            Clear
          </Button>
        )}
      </div>
    </form>
  );
}
