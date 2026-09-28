"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export interface PickerMember {
  id: string;
  name: string;
  email: string;
  username: string;
  avatarUrl?: string;
}

/**
 * Searchable member combobox. Writes the chosen member id into a hidden
 * input called `name`, so it works inside plain forms.
 */
export function MemberPicker({
  name,
  members,
  defaultValue,
  invalid,
  onChange,
  placeholder = "Search by name or email",
  id,
}: {
  name: string;
  members: PickerMember[];
  defaultValue?: string;
  invalid?: boolean;
  onChange?: (id: string) => void;
  placeholder?: string;
  id?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-list`;
  const [selectedId, setSelectedId] = useState(defaultValue ?? "");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selected = members.find((m) => m.id === selectedId) ?? null;
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? members.filter((m) => `${m.name} ${m.email} ${m.username}`.toLowerCase().includes(q)) : members;
    return list.slice(0, 8);
  }, [members, query]);

  const choose = (member: PickerMember) => {
    setSelectedId(member.id);
    setQuery("");
    setOpen(false);
    onChange?.(member.id);
  };

  const clear = () => {
    setSelectedId("");
    onChange?.("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (open && results[active]) {
        e.preventDefault();
        choose(results[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selectedId} />
      {selected ? (
        <div className={cn("flex h-9.5 items-center gap-2 rounded-lg border bg-surface-1 px-2", invalid ? "border-danger" : "border-border-strong")}>
          <Avatar name={selected.name} src={selected.avatarUrl} size="xs" />
          <span className="min-w-0 flex-1 truncate text-sm">
            <span className="font-medium text-ink">{selected.name}</span> <span className="text-ink-muted">· {selected.email}</span>
          </span>
          <button type="button" onClick={clear} className="rounded p-1 text-ink-faint hover:bg-surface-2 hover:text-ink" aria-label="Change member">
            <Icon.X className="size-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Icon.Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <input
            id={inputId}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-invalid={invalid || undefined}
            autoComplete="off"
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown}
            className={cn(
              "h-9.5 w-full rounded-lg border bg-surface-1 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
              invalid ? "border-danger" : "border-border-strong",
            )}
          />
        </div>
      )}
      {open && !selected && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-surface-1 p-1 shadow-pop">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-muted">No members match “{query}”.</li>
          ) : (
            results.map((m, i) => (
              <li
                key={m.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(m);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm", i === active ? "bg-surface-2" : "")}
              >
                <Avatar name={m.name} src={m.avatarUrl} size="xs" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{m.name}</span>
                  <span className="block truncate text-xs text-ink-muted">{m.email}</span>
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
