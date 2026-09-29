"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CardGradient } from "@/lib/types";
import { cardGradients } from "@/lib/config";
import { cn, gradientFor } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { FileUpload } from "@/components/ui/file-upload";
import { SegmentedControl } from "@/components/ui/tabs";
import type { PickerOption } from "./types";
import { EditorIcon } from "./editor-icons";

/* ------------------------------------------------------------------ */
/* Tags input                                                          */
/* ------------------------------------------------------------------ */

export function TagsInput({
  id,
  name,
  value,
  onChange,
  suggestions = [],
  placeholder = "Add tag",
  max = 12,
  invalid,
}: {
  id?: string;
  name: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  max?: number;
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const lower = new Set(value.map((t) => t.toLowerCase()));
  const q = draft.trim().toLowerCase();
  const matches = q ? suggestions.filter((s) => s.toLowerCase().includes(q) && !lower.has(s.toLowerCase())).slice(0, 6) : [];

  const add = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, 32);
    setDraft("");
    if (!tag || lower.has(tag.toLowerCase()) || value.length >= max) return;
    onChange([...value, tag]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div>
      {value.map((t) => (
        <input key={t} type="hidden" name={name} value={t} />
      ))}
      <div
        className={cn(
          "flex min-h-9.5 flex-wrap items-center gap-1.5 rounded-lg border bg-surface-1 px-2 py-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25",
          invalid ? "border-danger" : "border-border-strong",
        )}
      >
        <Icon.Tag className="ml-0.5 size-4 shrink-0 text-ink-faint" />
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-md bg-surface-2 py-0.5 pl-2 pr-1 text-xs font-medium text-ink">
            {t}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== t))}
              className="rounded p-0.5 text-ink-faint hover:bg-surface-3 hover:text-danger"
              aria-label={`Remove tag ${t}`}
            >
              <Icon.X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={value.length >= max ? `Maximum ${max} tags` : placeholder}
          disabled={value.length >= max}
          aria-describedby={listId}
          className="h-6 min-w-24 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>
      <p id={listId} className="mt-1.5 text-xs text-ink-muted">
        {matches.length ? (
          <span className="flex flex-wrap items-center gap-1.5">
            Suggestions:
            {matches.map((m) => (
              <button key={m} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(m)} className="rounded-md border border-border px-1.5 py-px text-ink hover:bg-surface-2">
                {m}
              </button>
            ))}
          </span>
        ) : draft.trim() ? (
          <>Press Enter to create &ldquo;{draft.trim()}&rdquo;</>
        ) : (
          <>Press Enter or comma to add a tag.</>
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* List editor (outcomes / requirements)                               */
/* ------------------------------------------------------------------ */

interface ListRow {
  key: number;
  text: string;
}

let listRowKey = 0;
const nextRowKey = () => ++listRowKey;

export function ListEditor({
  name,
  value,
  onChange,
  placeholder,
  addLabel = "Add item",
  max = 20,
  invalid,
  label,
}: {
  name: string;
  value: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  max?: number;
  invalid?: boolean;
  /** Accessible name prefix for each row input, e.g. "Outcome". */
  label: string;
}) {
  // Stable keys so focus stays in the right row while typing.
  const [rows, setRows] = useState<ListRow[]>(() => value.map((text) => ({ key: nextRowKey(), text })));
  const [focusKey, setFocusKey] = useState<number | null>(null);

  const commit = (next: ListRow[]) => {
    setRows(next);
    onChange(next.map((r) => r.text));
  };
  const addAfter = (index: number) => {
    if (rows.length >= max) return;
    const row = { key: nextRowKey(), text: "" };
    const next = [...rows];
    next.splice(index + 1, 0, row);
    commit(next);
    setFocusKey(row.key);
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row!);
    commit(next);
  };

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="rounded-lg border border-dashed border-border-strong px-3 py-3 text-center text-sm text-ink-muted">Nothing added yet.</p>}
      <ol className="space-y-2">
        {rows.map((row, i) => (
          <li key={row.key} className="flex items-center gap-1.5">
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-faint">{i + 1}.</span>
            <Input
              name={name}
              value={row.text}
              invalid={invalid && !row.text.trim()}
              aria-label={`${label} ${i + 1}`}
              placeholder={placeholder}
              autoFocus={row.key === focusKey}
              maxLength={200}
              onChange={(e) => commit(rows.map((r) => (r.key === row.key ? { ...r, text: e.target.value } : r)))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAfter(i);
                } else if (e.key === "Backspace" && !row.text && rows.length > 0) {
                  e.preventDefault();
                  commit(rows.filter((r) => r.key !== row.key));
                  setFocusKey(rows[i - 1]?.key ?? null);
                }
              }}
            />
            <div className="flex shrink-0 items-center">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded-md p-1.5 text-ink-faint hover:bg-surface-2 hover:text-ink disabled:opacity-30" aria-label={`Move ${label.toLowerCase()} ${i + 1} up`}>
                <EditorIcon.ArrowUp className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === rows.length - 1}
                className="rounded-md p-1.5 text-ink-faint hover:bg-surface-2 hover:text-ink disabled:opacity-30"
                aria-label={`Move ${label.toLowerCase()} ${i + 1} down`}
              >
                <EditorIcon.ArrowDown className="size-3.5" />
              </button>
              <button type="button" onClick={() => commit(rows.filter((r) => r.key !== row.key))} className="rounded-md p-1.5 text-ink-faint hover:bg-danger/10 hover:text-danger" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}>
                <Icon.Trash className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => addAfter(rows.length - 1)}
        disabled={rows.length >= max}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
      >
        <Icon.Plus className="size-4" />
        {rows.length >= max ? `Maximum ${max} items` : addLabel}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Searchable multi-select                                             */
/* ------------------------------------------------------------------ */

export function MultiSelect({
  id,
  name,
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  invalid,
  max,
  onCreate,
  createLabel = "Create new",
}: {
  id?: string;
  name: string;
  options: PickerOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  invalid?: boolean;
  max?: number;
  /** Adds a trailing "create" option; called with the current search text. */
  onCreate?: (query: string) => void;
  createLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const selected = value.map((v) => byValue.get(v)).filter((o): o is PickerOption => !!o);
  const q = query.trim().toLowerCase();
  const filtered = options.filter((o) => !q || o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q));
  const atMax = max !== undefined && value.length >= max;
  const createIndex = onCreate ? filtered.length : -1;
  const lastIndex = onCreate ? filtered.length : filtered.length - 1;

  const create = () => {
    if (!onCreate) return;
    const q = query;
    setOpen(false);
    setQuery("");
    onCreate(q);
  };

  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else if (!atMax) onChange([...value, v]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(lastIndex, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = filtered[active];
      if (open && active === createIndex) create();
      else if (open && option) toggle(option.value);
      else setOpen(true);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    } else if (e.key === "Backspace" && !query && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {value.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
      <div
        className={cn(
          "flex min-h-9.5 flex-wrap items-center gap-1.5 rounded-lg border bg-surface-1 px-2 py-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25",
          invalid ? "border-danger" : "border-border-strong",
        )}
        onClick={() => setOpen(true)}
      >
        {selected.map((o) => (
          <span key={o.value} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-2 py-0.5 pl-1 pr-1 text-xs font-medium text-ink">
            {o.avatar ? <Avatar name={o.avatar.name} src={o.avatar.src} size="xs" className="!size-5" /> : <span className="w-1" />}
            <span className="truncate">{o.label}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggle(o.value);
              }}
              className="rounded p-0.5 text-ink-faint hover:bg-surface-3 hover:text-danger"
              aria-label={`Remove ${o.label}`}
            >
              <Icon.X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={selected.length ? searchPlaceholder : placeholder}
          className="h-6 min-w-28 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <Icon.ChevronsUpDown className="size-4 shrink-0 text-ink-faint" />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="scrollbar-thin absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-surface-1 p-1 shadow-pop animate-scale-in"
        >
          {filtered.length === 0 ? (
            <li role="presentation" className="px-3 py-2.5 text-sm text-ink-muted">
              {emptyText}
            </li>
          ) : (
            filtered.map((o, i) => {
              const isSelected = value.includes(o.value);
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => toggle(o.value)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm",
                    i === active ? "bg-surface-2" : "",
                    !isSelected && atMax && "cursor-not-allowed opacity-50",
                  )}
                >
                  <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", isSelected ? "border-accent bg-accent text-accent-fg" : "border-border-strong")}>
                    {isSelected && <Icon.Check className="size-3" />}
                  </span>
                  {o.avatar && <Avatar name={o.avatar.name} src={o.avatar.src} size="xs" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{o.label}</span>
                    {o.description && <span className="block truncate text-xs text-ink-muted">{o.description}</span>}
                  </span>
                </li>
              );
            })
          )}
          {onCreate && (
            <li
              role="option"
              aria-selected={false}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(createIndex)}
              onClick={create}
              className={cn(
                "mt-1 flex cursor-pointer items-center gap-2.5 rounded-lg border-t border-border px-2.5 py-2 text-sm font-medium text-accent",
                active === createIndex ? "bg-surface-2" : "",
              )}
            >
              <Icon.Plus className="size-4 shrink-0" />
              <span className="truncate">{query.trim() ? `${createLabel} “${query.trim()}”` : createLabel}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card gradient picker                                                */
/* ------------------------------------------------------------------ */

export function GradientPicker({ name, value, onChange }: { name: string; value: CardGradient; onChange: (value: CardGradient) => void }) {
  return (
    <div role="radiogroup" aria-label="Card color" className="flex flex-wrap gap-2">
      {cardGradients.map((g) => {
        const checked = g === value;
        return (
          <label key={g} className="relative cursor-pointer" title={g.charAt(0).toUpperCase() + g.slice(1)}>
            <input type="radio" name={name} value={g} checked={checked} onChange={() => onChange(g)} className="peer sr-only" />
            <span
              className={cn(
                "block size-8 rounded-lg bg-gradient-to-tr ring-offset-2 ring-offset-surface-1 transition-shadow peer-focus-visible:ring-2 peer-focus-visible:ring-accent",
                gradientFor(g),
                checked && "ring-2 ring-ink",
              )}
            />
            {checked && <Icon.Check className="pointer-events-none absolute inset-0 m-auto size-4 text-white drop-shadow" />}
            <span className="sr-only">{g}</span>
          </label>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Upload-or-URL media field                                           */
/* ------------------------------------------------------------------ */

export function MediaField({
  id,
  name,
  value,
  onChange,
  kind,
  accept,
  urlPlaceholder = "https://…",
  hint,
  invalid,
  disabled,
}: {
  id?: string;
  name?: string;
  value: string;
  /** `meta` is present right after a successful upload. */
  onChange: (url: string, meta?: { name: string; size: number; type: string }) => void;
  kind: "video" | "image" | "document" | "auto";
  accept?: string;
  urlPlaceholder?: string;
  hint?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const isUpload = !value || value.startsWith("/uploads/");
  const [mode, setMode] = useState<"upload" | "url">(isUpload ? "upload" : "url");
  return (
    <div className="space-y-2">
      {name && mode === "url" && <input type="hidden" name={name} value={value} />}
      <SegmentedControl
        size="xs"
        value={mode}
        onChange={setMode}
        options={[
          { value: "upload", label: "Upload", icon: <Icon.Upload className="size-3" /> },
          { value: "url", label: "Link", icon: <Icon.Link className="size-3" /> },
        ]}
      />
      {mode === "upload" ? (
        <FileUpload
          name={name}
          kind={kind}
          accept={accept}
          value={value}
          disabled={disabled}
          hint={hint}
          onChange={(url, meta) => onChange(url, meta)}
        />
      ) : (
        <div className="space-y-1.5">
          <Input id={id} type="url" inputMode="url" value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder={urlPlaceholder} invalid={invalid} disabled={disabled} leftAddon={<Icon.Link className="size-4" />} />
          {hint && <p className="text-xs text-ink-muted">{hint}</p>}
        </div>
      )}
    </div>
  );
}
