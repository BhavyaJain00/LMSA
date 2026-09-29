"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Textarea, type TextareaProps } from "@/components/ui/input";
import type { MentionOption } from "./types";

const MAX_SUGGESTIONS = 8;
/** "@query" right before the caret, at the start or after whitespace/punctuation (same rule the server uses). */
const TRIGGER = /(^|[^\w@])@([a-z0-9._-]{0,64})$/i;

interface Trigger {
  /** Index of the "@" in the text. */
  start: number;
  /** Caret position (end of the typed query). */
  end: number;
  query: string;
}

export interface MentionTextareaProps extends Omit<TextareaProps, "value" | "defaultValue" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  mentionables: MentionOption[];
  /** Where the suggestion list opens relative to the field. */
  placement?: "above" | "below";
}

function findTrigger(text: string, caret: number): Trigger | null {
  const m = TRIGGER.exec(text.slice(0, caret));
  if (!m) return null;
  const query = m[2] ?? "";
  return { start: caret - query.length - 1, end: caret, query };
}

function rank(option: MentionOption, q: string): number {
  if (!q) return option.isInstructor ? 0 : 1;
  const username = option.username.toLowerCase();
  const name = option.name.toLowerCase();
  if (username.startsWith(q)) return 0;
  if (name.startsWith(q) || name.split(/\s+/).some((part) => part.startsWith(q))) return 1;
  if (username.includes(q) || name.includes(q)) return 2;
  return -1;
}

/**
 * Textarea with @mention autocomplete: typing "@" followed by part of a name
 * or username opens a list of people the viewer may mention. Arrow keys move,
 * Enter/Tab insert "@username ", Escape closes the list.
 */
export function MentionTextarea({
  value,
  onValueChange,
  mentionables,
  placement = "above",
  onKeyDown,
  onBlur,
  className,
  ...props
}: MentionTextareaProps) {
  const listId = useId();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  /** Start index of a trigger the user dismissed with Escape, so it stays closed until they type a new "@". */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const suggestions = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    return mentionables
      .map((option, index) => ({ option, index, score: rank(option, q) }))
      .filter((s) => s.score >= 0)
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .slice(0, MAX_SUGGESTIONS)
      .map((s) => s.option);
  }, [mentionables, trigger]);

  const open = !!trigger && trigger.start !== dismissedAt && suggestions.length > 0;
  const activeIndex = Math.min(active, Math.max(0, suggestions.length - 1));

  const sync = (text: string, caret: number | null) => {
    const next = caret == null ? null : findTrigger(text, caret);
    if (!next || !trigger || trigger.start !== next.start || trigger.query !== next.query) setActive(0);
    setTrigger(next);
    if (!next || next.start !== dismissedAt) setDismissedAt(null);
  };

  const choose = (option: MentionOption) => {
    if (!trigger) return;
    const before = value.slice(0, trigger.start);
    const after = value.slice(trigger.end).replace(/^[a-z0-9._-]*/i, "");
    const insert = `@${option.username}${/^\s/.test(after) ? "" : " "}`;
    const next = `${before}${insert}${after}`;
    const caret = before.length + insert.length;
    onValueChange(next);
    setTrigger(null);
    setActive(0);
    requestAnimationFrame(() => {
      const area = areaRef.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setActive((activeIndex + delta + suggestions.length) % suggestions.length);
        return;
      }
      if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey) || e.key === "Tab") {
        const option = suggestions[activeIndex];
        if (option) {
          e.preventDefault();
          choose(option);
          return;
        }
      }
      if (e.key === "Escape") {
        // Close the list without closing a surrounding dialog.
        e.preventDefault();
        e.stopPropagation();
        if (trigger) setDismissedAt(trigger.start);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative">
      <Textarea
        {...props}
        ref={areaRef}
        value={value}
        className={className}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        onChange={(e) => {
          onValueChange(e.target.value);
          sync(e.target.value, e.target.selectionStart);
        }}
        onSelect={(e) => sync(e.currentTarget.value, e.currentTarget.selectionStart)}
        onKeyDown={handleKeyDown}
        onBlur={(e) => {
          setTrigger(null);
          onBlur?.(e);
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="People you can mention"
          className={cn(
            "absolute inset-x-0 z-30 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface-1 p-1 shadow-pop",
            placement === "above" ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {suggestions.map((option, i) => (
            <li
              key={option.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              // Keep focus (and the caret) in the textarea while picking.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(option)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                i === activeIndex ? "bg-surface-2 text-ink" : "text-ink-muted",
              )}
            >
              <Avatar name={option.name} src={option.avatarUrl} size="xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{option.name}</span>
                <span className="block truncate text-xs text-ink-faint">@{option.username}</span>
              </span>
              {option.isInstructor && (
                <Badge tone="accent" size="xs">
                  Instructor
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
