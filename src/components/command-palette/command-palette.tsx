"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon, Spinner, type IconName } from "@/components/ui/icons";
import { getTheme, setTheme } from "@/components/ui/theme-toggle";
import { cn, relativeTime } from "@/lib/utils";
import type { PaletteCommand, PaletteConfig, PaletteScope, SearchResultGroup, SearchScope } from "./config";
import { OPEN_COMMAND_PALETTE_EVENT } from "./events";
import { fuzzyMatch, highlightSegments } from "./fuzzy";

type Item =
  | { kind: "scope"; id: string; label: string; icon: IconName; scope: PaletteScope; indices?: number[] }
  | {
      kind: "link";
      id: string;
      label: string;
      icon: IconName;
      href: string;
      subtitle?: string;
      meta?: string;
      indices?: number[];
      disabled?: boolean;
    }
  | { kind: "action"; id: string; label: string; icon: IconName; run: () => void; indices?: number[] };

interface Group {
  label: string;
  items: Item[];
}

const scopeIcon: Record<SearchScope, IconName> = {
  courses: "BookOpen",
  batches: "Users",
  programs: "Layers",
  jobs: "Briefcase",
  quizzes: "ListChecks",
  assignments: "ClipboardList",
  people: "User",
};

const GROUP_ORDER = ["Manage", "Links", "Account"];

function Highlighted({ text, indices }: { text: string; indices?: number[] }) {
  if (!indices?.length) return <>{text}</>;
  return (
    <>
      {highlightSegments(text, indices).map((seg, i) =>
        seg.match ? (
          <mark key={i} className="rounded-sm bg-warning/25 px-px text-inherit">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-border bg-surface-2 px-1 font-sans text-[10px] font-medium text-ink-muted">{children}</kbd>;
}

/**
 * Command palette (Ctrl/Cmd+K). Before typing it offers categories to scope
 * the search and the same navigation targets as the sidebar; while typing it
 * fuzzy-matches those targets locally and queries /api/search for courses,
 * batches, programs, jobs, quizzes, assignments and people.
 */
export function CommandPalette({ commands, scopes }: PaletteConfig) {
  const router = useRouter();
  const baseId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<PaletteScope | null>(null);
  const [remote, setRemote] = useState<{ key: string; groups: SearchResultGroup[] } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [active, setActive] = useState(0);

  const trimmed = query.trim();
  const requestKey = `${scope?.key ?? "all"}|${trimmed.toLowerCase()}`;
  const searching = trimmed.length >= 2;

  const reset = useCallback(() => {
    setQuery("");
    setScope(null);
    setRemote(null);
    setStatus("idle");
    setActive(0);
  }, []);

  const openPalette = useCallback(() => {
    reset();
    setOpen(true);
  }, [reset]);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  /* Global shortcut and "open" event */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialogRef.current?.open) close();
        else openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, openPalette);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, openPalette);
    };
  }, [close, openPalette]);

  /* Keep the native <dialog> in sync with state */
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      close();
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, [close]);

  /* Debounced server search */
  useEffect(() => {
    if (!open || !searching) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const qs = new URLSearchParams({ q: trimmed });
        if (scope) qs.set("scope", scope.key);
        const res = await fetch(`/api/search?${qs.toString()}`, { signal: controller.signal, headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = (await res.json()) as { ok: boolean; groups?: SearchResultGroup[] };
        if (!data.ok) throw new Error("Search failed");
        setRemote({ key: requestKey, groups: data.groups ?? [] });
        setStatus("idle");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setStatus("error");
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, searching, trimmed, scope, requestKey]);

  const themeAction = useMemo<Item>(
    () => ({ kind: "action", id: "action:theme", label: "Toggle dark mode", icon: "Moon", run: () => setTheme(getTheme() === "dark" ? "light" : "dark") }),
    [],
  );

  const groups = useMemo<Group[]>(() => {
    const toLink = (c: PaletteCommand, indices?: number[]): Item => ({ kind: "link", id: c.id, label: c.label, icon: c.icon, href: c.href, indices });
    const out: Group[] = [];

    if (!trimmed) {
      if (scope) {
        out.push({
          label: scope.label,
          items: [{ kind: "link", id: `all:${scope.key}`, label: `View all ${scope.label}`, icon: scope.icon, href: scope.viewAllHref }],
        });
        return out;
      }
      const jump: Item[] = [
        ...scopes.map((s): Item => ({ kind: "scope", id: `scope:${s.key}`, label: s.label, icon: s.icon, scope: s })),
        ...commands.filter((c) => c.group === "Jump to").map((c) => toLink(c)),
      ];
      if (jump.length) out.push({ label: "Jump to", items: jump });
      for (const label of GROUP_ORDER) {
        const items = commands.filter((c) => c.group === label).map((c) => toLink(c));
        if (label === "Account") items.push(themeAction);
        if (items.length) out.push({ label, items });
      }
      return out;
    }

    if (!scope) {
      const local: { item: Item; score: number }[] = [];
      for (const s of scopes) {
        const m = fuzzyMatch(trimmed, s.label);
        if (m && m.score >= 1000) local.push({ item: { kind: "scope", id: `scope:${s.key}`, label: s.label, icon: s.icon, scope: s, indices: m.indices }, score: m.score + 50 });
      }
      for (const c of commands) {
        const m = fuzzyMatch(trimmed, c.label);
        const k = !m && c.keywords ? fuzzyMatch(trimmed, c.keywords) : null;
        if (m) local.push({ item: toLink(c, m.indices), score: m.score });
        else if (k && k.score >= 1000) local.push({ item: toLink(c), score: k.score * 0.5 });
      }
      const tm = fuzzyMatch(trimmed, themeAction.label) ?? fuzzyMatch(trimmed, "theme dark light mode");
      if (tm) local.push({ item: { ...themeAction, indices: fuzzyMatch(trimmed, themeAction.label)?.indices }, score: tm.score * 0.8 });
      local.sort((a, b) => b.score - a.score);
      if (local.length) out.push({ label: "Jump to", items: local.slice(0, 6).map((l) => l.item) });
    }

    if (searching && remote) {
      const stale = remote.key !== requestKey;
      for (const g of remote.groups) {
        out.push({
          label: g.label,
          items: g.items.map((r) => ({
            kind: "link",
            id: `${g.key}:${r.id}`,
            label: r.title,
            subtitle: r.subtitle,
            href: r.href,
            icon: scopeIcon[g.key],
            indices: stale ? undefined : r.indices,
            meta: r.updatedAt,
            disabled: stale,
          })),
        });
      }
    }
    return out;
  }, [trimmed, scope, scopes, commands, themeAction, searching, remote, requestKey]);

  const flat = useMemo(() => groups.flatMap((g) => g.items).filter((i) => !(i.kind === "link" && i.disabled)), [groups]);
  const activeIndex = flat.length ? Math.min(active, flat.length - 1) : -1;
  const activeItem = activeIndex >= 0 ? flat[activeIndex] : undefined;
  const optionId = (item: Item) => `${baseId}-opt-${item.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  const activeId = activeItem ? optionId(activeItem) : undefined;

  useEffect(() => {
    if (!open || !activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [open, activeId]);

  const select = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "scope") {
      setScope(item.scope);
      setQuery("");
      setRemote(null);
      setStatus("idle");
      setActive(0);
      inputRef.current?.focus();
      return;
    }
    if (item.kind === "action") {
      item.run();
      close();
      return;
    }
    if (item.disabled) return;
    close();
    if (/^(https?:|mailto:)/.test(item.href)) window.open(item.href, "_blank", "noopener,noreferrer");
    else router.push(item.href);
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flat.length) setActive((activeIndex + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setActive((activeIndex - 1 + flat.length) % flat.length);
    } else if (e.key === "Home" && e.ctrlKey) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && e.ctrlKey) {
      e.preventDefault();
      setActive(Math.max(0, flat.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(activeItem);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (scope && !query) {
        setScope(null);
        setRemote(null);
        setActive(0);
      } else close();
    } else if (e.key === "Backspace" && !query && scope) {
      e.preventDefault();
      setScope(null);
      setRemote(null);
      setActive(0);
    }
  };

  const settled = searching && status === "idle" && remote?.key === requestKey;
  const nothing = groups.every((g) => g.items.length === 0);
  const listId = `${baseId}-list`;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${baseId}-title`}
      onClick={(e) => {
        if (e.target === dialogRef.current) close();
      }}
      className="mx-auto mb-auto mt-[8vh] w-[calc(100%-1.5rem)] max-w-xl overflow-hidden rounded-2xl border border-border bg-surface-1 p-0 text-ink shadow-pop backdrop:bg-black/50 backdrop:backdrop-blur-[2px] open:animate-scale-in sm:mt-[12vh]"
    >
      <h2 id={`${baseId}-title`} className="sr-only">
        Command palette
      </h2>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Icon.Search className="size-4.5 shrink-0 text-ink-faint" />
        {scope && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent/10 py-0.5 pl-2 pr-1 text-xs font-medium text-accent">
            {scope.label}
            <button
              type="button"
              onClick={() => {
                setScope(null);
                setRemote(null);
                setActive(0);
                inputRef.current?.focus();
              }}
              className="rounded p-0.5 hover:bg-accent/15"
              aria-label={`Stop searching ${scope.label}`}
            >
              <Icon.X className="size-3" />
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onInputKeyDown}
          placeholder={scope ? `Search ${scope.label.toLowerCase()}` : "Search"}
          aria-label="Search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          className="h-12 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none sm:text-sm"
        />
        {status === "loading" && <Spinner className="size-4 shrink-0 text-ink-faint" />}
        <button type="button" onClick={close} className="shrink-0 rounded-md px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-2 sm:hidden">
          Close
        </button>
      </div>

      <ul id={listId} role="listbox" aria-label="Results" className="max-h-96 overflow-y-auto overscroll-contain p-2 scrollbar-thin">
        {groups.map((group) => {
          const headingId = `${baseId}-g-${group.label.replace(/\W/g, "")}`;
          return (
            <li key={group.label} role="presentation" className="mb-1 last:mb-0">
              <p id={headingId} className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                {group.label}
              </p>
              <ul role="group" aria-labelledby={headingId}>
                {group.items.map((item) => {
                  const selected = !!activeItem && activeItem.id === item.id;
                  const disabled = item.kind === "link" && !!item.disabled;
                  const IconCmp = Icon[item.icon] ?? Icon.Dot;
                  return (
                    <li
                      key={item.id}
                      id={optionId(item)}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={disabled || undefined}
                      onMouseMove={() => {
                        if (disabled) return;
                        const idx = flat.findIndex((f) => f.id === item.id);
                        if (idx !== -1 && idx !== activeIndex) setActive(idx);
                      }}
                      onClick={() => select(item)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm",
                        selected ? "bg-surface-2 text-ink" : "text-ink",
                        disabled && "cursor-default opacity-50",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-md [&>svg]:size-4",
                          selected ? "bg-accent/10 text-accent" : "bg-surface-2 text-ink-muted",
                        )}
                        aria-hidden="true"
                      >
                        <IconCmp />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          <Highlighted text={item.label} indices={item.indices} />
                        </span>
                        {item.kind === "link" && item.subtitle && <span className="block truncate text-xs text-ink-muted">{item.subtitle}</span>}
                      </span>
                      {item.kind === "scope" && <Icon.ChevronRight className="size-4 shrink-0 text-ink-faint rtl:rotate-180" />}
                      {item.kind === "link" && item.meta && <span className="hidden shrink-0 text-[11px] text-ink-faint sm:inline">{relativeTime(item.meta)}</span>}
                      {item.kind === "link" && /^(https?:|mailto:)/.test(item.href) && <Icon.ExternalLink className="size-3.5 shrink-0 text-ink-faint" />}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
        {status === "error" && searching && (
          <li role="presentation" className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-danger">
            <Icon.AlertCircle className="size-4" />
            Could not search just now. Try again.
          </li>
        )}
        {status !== "error" && settled && nothing && (
          <li role="presentation" className="px-3 py-8 text-center text-sm text-ink-muted">
            No results found
          </li>
        )}
        {!searching && trimmed.length === 1 && nothing && (
          <li role="presentation" className="px-3 py-8 text-center text-sm text-ink-muted">
            Keep typing to search…
          </li>
        )}
      </ul>

      <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-ink-muted sm:flex">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          to navigate
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd>
          to select
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd>
          to close
        </span>
      </div>
    </dialog>
  );
}
