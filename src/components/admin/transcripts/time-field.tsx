"use client";

import { useState, type KeyboardEvent } from "react";
import { formatTimeInput, parseTimeInput } from "@/lib/transcripts/editor-state";
import { cn } from "@/lib/utils";

/**
 * A caption time ("1:02.500"). Typing is free; the value is committed on
 * Enter or blur and reverted with Escape. Arrow up/down nudge it by 0.1 s
 * (Shift: 1 s, Alt: 0.01 s) and commit straight away.
 */
export function TimeField({
  value,
  onCommit,
  label,
  id,
  className,
}: {
  value: number;
  /** Returns an error message when the new time is refused. */
  onCommit: (seconds: number) => string | null;
  label: string;
  id?: string;
  className?: string;
}) {
  const formatted = formatTimeInput(value);
  const [draft, setDraft] = useState<{ text: string; base: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A draft belongs to the value it was typed over; a new value from outside replaces it.
  const text = draft && draft.base === formatted ? draft.text : formatted;

  const commit = (raw: string) => {
    const seconds = parseTimeInput(raw);
    if (seconds === null) {
      setError("Enter a time such as 1:02.500");
      return;
    }
    const refused = Math.abs(seconds - value) < 0.0005 ? null : onCommit(seconds);
    setError(refused);
    setDraft(refused ? { text: raw, base: formatted } : null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(text);
    } else if (e.key === "Escape") {
      if (draft) {
        e.preventDefault();
        e.stopPropagation();
        setDraft(null);
        setError(null);
      }
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const step = (e.shiftKey ? 1 : e.altKey ? 0.01 : 0.1) * (e.key === "ArrowUp" ? 1 : -1);
      const current = parseTimeInput(text) ?? value;
      const next = Math.max(0, Math.round((current + step) * 1000) / 1000);
      const refused = onCommit(next);
      setError(refused);
      setDraft(null);
    }
  };

  return (
    <span className={cn("relative block", className)}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        title={error ?? `${label}. Arrow keys nudge it by 0.1 s (Shift: 1 s).`}
        value={text}
        onChange={(e) => {
          setDraft({ text: e.target.value, base: formatted });
          setError(null);
        }}
        onBlur={() => {
          if (draft) commit(text);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "h-8 w-full rounded-md border bg-surface px-2 font-mono text-xs tabular-nums text-ink outline-none transition-colors",
          "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30",
          error ? "border-danger" : "border-border hover:border-border-strong",
        )}
      />
      {error && (
        <span role="alert" className="absolute start-0 top-full z-10 mt-1 w-max max-w-56 rounded-md bg-danger px-2 py-1 text-[11px] font-medium text-white shadow-pop">
          {error}
        </span>
      )}
    </span>
  );
}
