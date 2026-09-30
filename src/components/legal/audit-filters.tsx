"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export interface AuditFilterValues {
  q: string;
  actor: string;
  action: string;
  target: string;
  from: string;
  to: string;
}

export interface AuditFilterOptions {
  actors: { value: string; label: string }[];
  actionGroups: { value: string; label: string; actions: { value: string; label: string }[] }[];
  targets: { value: string; label: string }[];
}

const EMPTY: AuditFilterValues = { q: "", actor: "", action: "", target: "", from: "", to: "" };

const selectClass =
  "h-9.5 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-ink focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30";

/**
 * URL-driven filters for the audit log: text search (debounced), actor,
 * action (grouped), target type and a date range. Changing a filter goes back
 * to page 1 and closes the detail drawer.
 */
export function AuditFilters({ values, options }: { values: AuditFilterValues; options: AuditFilterOptions }) {
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

  const apply = (patch: Partial<AuditFilterValues>) => {
    const merged = { ...values, q, ...patch };
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value.trim()) qs.set(key, value.trim());
    const query = qs.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  const active = Object.entries(values).some(([, v]) => v);

  return (
    <div className="space-y-2 rounded-card border border-border bg-surface-1 p-3 sm:p-4" aria-busy={pending}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <Input
          type="search"
          aria-label="Search the audit log"
          placeholder="Search action, member, id or IP"
          value={q}
          onChange={(e) => {
            const value = e.target.value;
            setQ(value);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => apply({ q: value }), 350);
          }}
          leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
        />
        <select aria-label="Filter by who did it" className={selectClass} value={values.actor} onChange={(e) => apply({ actor: e.target.value })}>
          <option value="">Anyone</option>
          {options.actors.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <select aria-label="Filter by action" className={selectClass} value={values.action} onChange={(e) => apply({ action: e.target.value })}>
          <option value="">Any action</option>
          {options.actionGroups.map((g) => (
            <optgroup key={g.value} label={g.label}>
              <option value={g.value}>All {g.label.toLowerCase()} actions</option>
              {g.actions.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select aria-label="Filter by target" className={selectClass} value={values.target} onChange={(e) => apply({ target: e.target.value })}>
          <option value="">Any target</option>
          {options.targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[9.5rem] flex-1 sm:flex-none">
          <Label htmlFor="audit-from" className="mb-1 text-xs">
            From
          </Label>
          <Input id="audit-from" type="date" value={values.from} max={values.to || undefined} onChange={(e) => apply({ from: e.target.value })} />
        </div>
        <div className="min-w-[9.5rem] flex-1 sm:flex-none">
          <Label htmlFor="audit-to" className="mb-1 text-xs">
            To
          </Label>
          <Input id="audit-to" type="date" value={values.to} min={values.from || undefined} onChange={(e) => apply({ to: e.target.value })} />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={cn("mb-0.5", !active && "invisible")}
          leftIcon={<Icon.X className="size-4" />}
          onClick={() => {
            setQ("");
            apply(EMPTY);
          }}
          tabIndex={active ? undefined : -1}
          aria-hidden={active ? undefined : true}
        >
          Clear filters
        </Button>
      </div>
    </div>
  );
}
