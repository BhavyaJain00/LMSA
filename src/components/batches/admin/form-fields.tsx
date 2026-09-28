"use client";

import { useId, useMemo, useState } from "react";
import { Markdown } from "@/lib/markdown";
import { timezones } from "@/lib/config";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { useViewerTimeZone } from "../hooks";
import type { Option } from "../types";

/** Markdown textarea with a Write / Preview toggle. */
export function MarkdownField({
  id,
  name,
  value,
  onChange,
  rows = 8,
  placeholder,
  invalid,
  required,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  invalid?: boolean;
  required?: boolean;
}) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  return (
    <div className="overflow-hidden rounded-lg border border-border-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 aria-[invalid=true]:border-danger" aria-invalid={invalid || undefined}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-2 py-1.5">
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={setMode}
          options={[
            { value: "write", label: "Write", icon: <Icon.Edit className="size-3" /> },
            { value: "preview", label: "Preview", icon: <Icon.Eye className="size-3" /> },
          ]}
        />
        <span className="hidden text-[11px] text-ink-faint sm:inline">Markdown: **bold**, _italic_, - lists, [links](https://…)</span>
      </div>
      {/* Keep the textarea mounted so the value is always submitted with the form. */}
      <Textarea
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        required={required}
        invalid={invalid}
        className={cn("rounded-none border-0 focus:ring-0", mode === "preview" && "hidden")}
      />
      {mode === "preview" && (
        <div className="min-h-32 bg-surface-1 px-3 py-2" style={{ minHeight: `${rows * 1.6}rem` }}>
          {value.trim() ? <Markdown content={value} className="text-sm" /> : <p className="text-sm text-ink-faint">Nothing to preview yet.</p>}
        </div>
      )}
    </div>
  );
}

/** Searchable multi-select of people (e.g. instructors) that submits `name` for every selected value. */
export function PeoplePicker({
  name,
  options,
  value,
  onChange,
  invalid,
  placeholder = "Search by name or email",
  emptyText = "No matching people",
}: {
  name: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  invalid?: boolean;
  placeholder?: string;
  emptyText?: string;
}) {
  const [query, setQuery] = useState("");
  const listId = useId();
  const byId = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const q = query.trim().toLowerCase();
  const filtered = options.filter((o) => !q || `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className={cn("rounded-lg border bg-surface-1", invalid ? "border-danger" : "border-border-strong")}>
      {value.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 border-b border-border p-2" aria-label="Selected">
          {value.map((id) => {
            const o = byId.get(id);
            return (
              <li key={id} className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 py-0.5 pl-1 pr-1.5 text-xs font-medium text-accent">
                <Avatar name={o?.label ?? "Unknown"} size="xs" className="size-5 text-[9px]" />
                {o?.label ?? "Unknown user"}
                <button type="button" onClick={() => toggle(id)} className="rounded-full p-0.5 hover:bg-accent/15" aria-label={`Remove ${o?.label ?? "user"}`}>
                  <Icon.X className="size-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="p-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          leftAddon={<Icon.Search className="size-4" />}
          aria-controls={listId}
          aria-label={placeholder}
          className="h-8"
        />
      </div>
      <ul id={listId} className="scrollbar-thin max-h-48 overflow-y-auto border-t border-border p-1" role="listbox" aria-multiselectable="true">
        {filtered.length === 0 && <li className="px-2 py-3 text-center text-xs text-ink-muted">{emptyText}</li>}
        {filtered.map((o) => {
          const selected = value.includes(o.value);
          return (
            <li key={o.value} role="option" aria-selected={selected}>
              <button
                type="button"
                onClick={() => toggle(o.value)}
                className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2", selected && "bg-accent/5")}
              >
                <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", selected ? "border-accent bg-accent text-accent-fg" : "border-border-strong")}>
                  {selected && <Icon.Check className="size-3" />}
                </span>
                <Avatar name={o.label} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{o.label}</span>
                  {o.hint && <span className="block truncate text-xs text-ink-muted">{o.hint}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Timezone select (curated list + current value) with a "use my timezone" shortcut. */
export function TimezoneSelect({
  id,
  name,
  value,
  onChange,
  invalid,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  const viewerTz = useViewerTimeZone();
  const list = Array.from(new Set([...(value ? [value] : []), ...timezones, ...(viewerTz ? [viewerTz] : [])])).sort((a, b) => a.localeCompare(b));
  return (
    <div className="space-y-1.5">
      <Select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid} required>
        <option value="" disabled>
          Select timezone
        </option>
        {list.map((tz) => (
          <option key={tz} value={tz}>
            {tz.replace(/_/g, " ")}
          </option>
        ))}
      </Select>
      {viewerTz && viewerTz !== value && (
        <Button variant="link" size="xs" onClick={() => onChange(viewerTz)} className="h-auto text-xs">
          Use my timezone ({viewerTz.replace(/_/g, " ")})
        </Button>
      )}
    </div>
  );
}

/** Grouped <select> built from options with an optional `group`. */
export function GroupedSelect({
  id,
  name,
  value,
  onChange,
  options,
  placeholder,
  invalid,
  disabled,
}: {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const groups = new Map<string, Option[]>();
  for (const o of options) {
    const key = o.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const label = (o: Option) => (o.hint ? `${o.label} — ${o.hint}` : o.label);
  return (
    <Select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid} disabled={disabled}>
      <option value="">{placeholder}</option>
      {Array.from(groups.entries()).map(([group, opts]) =>
        group ? (
          <optgroup key={group} label={group}>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {label(o)}
              </option>
            ))}
          </optgroup>
        ) : (
          opts.map((o) => (
            <option key={o.value} value={o.value}>
              {label(o)}
            </option>
          ))
        ),
      )}
    </Select>
  );
}
