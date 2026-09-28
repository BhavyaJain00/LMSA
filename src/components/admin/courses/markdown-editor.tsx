"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Markdown } from "@/lib/markdown";
import { cn, formatNumber } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { EditorIcon } from "./editor-icons";

export interface MarkdownEditorProps {
  id?: string;
  /** When set, a hidden input carries the value in form submissions. */
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  describedBy?: string;
  /** Label for screen readers when there is no visible <label>. */
  ariaLabel?: string;
  autoFocus?: boolean;
  /** Compact toolbar for nested editors (e.g. inside a lesson block). */
  compact?: boolean;
}

type Selection = { start: number; end: number };

interface EditResult {
  value: string;
  selection: Selection;
}

/* ------------------------------------------------------------------ */
/* Pure text transforms                                                */
/* ------------------------------------------------------------------ */

function wrapSelection(value: string, sel: Selection, before: string, after: string, placeholder: string): EditResult {
  const selected = value.slice(sel.start, sel.end);
  const outerBefore = value.slice(Math.max(0, sel.start - before.length), sel.start);
  const outerAfter = value.slice(sel.end, sel.end + after.length);
  // Toggle off when the selection is already wrapped.
  if (selected && outerBefore === before && outerAfter === after) {
    const next = value.slice(0, sel.start - before.length) + selected + value.slice(sel.end + after.length);
    return { value: next, selection: { start: sel.start - before.length, end: sel.end - before.length } };
  }
  const inner = selected || placeholder;
  const next = value.slice(0, sel.start) + before + inner + after + value.slice(sel.end);
  const start = sel.start + before.length;
  return { value: next, selection: { start, end: start + inner.length } };
}

function lineRange(value: string, sel: Selection): Selection {
  const start = value.lastIndexOf("\n", sel.start - 1) + 1;
  let end = value.indexOf("\n", sel.end > sel.start && value[sel.end - 1] === "\n" ? sel.end - 1 : sel.end);
  if (end === -1) end = value.length;
  return { start, end };
}

function prefixLines(value: string, sel: Selection, kind: "bullet" | "numbered" | "quote" | "heading"): EditResult {
  const range = lineRange(value, sel);
  const lines = value.slice(range.start, range.end).split("\n");
  const patterns = {
    bullet: /^(\s*)[-*+]\s+/,
    numbered: /^(\s*)\d+[.)]\s+/,
    quote: /^(\s*)>\s?/,
    heading: /^(#{1,6})\s+/,
  } as const;
  const pattern = patterns[kind];
  const allPrefixed = lines.filter((l) => l.trim()).every((l) => pattern.test(l)) && lines.some((l) => l.trim());
  let n = 0;
  const nextLines = lines.map((line) => {
    if (allPrefixed) return line.replace(pattern, kind === "heading" ? "" : "$1");
    if (!line.trim() && lines.length > 1) return line;
    const stripped = line.replace(patterns.bullet, "$1").replace(patterns.numbered, "$1").replace(patterns.quote, "$1").replace(patterns.heading, "");
    switch (kind) {
      case "bullet":
        return `- ${stripped}`;
      case "numbered":
        return `${++n}. ${stripped}`;
      case "quote":
        return `> ${stripped}`;
      case "heading":
        return `## ${stripped}`;
    }
  });
  const replaced = nextLines.join("\n");
  const next = value.slice(0, range.start) + replaced + value.slice(range.end);
  return { value: next, selection: { start: range.start, end: range.start + replaced.length } };
}

function insertLink(value: string, sel: Selection): EditResult {
  const selected = value.slice(sel.start, sel.end);
  const isUrl = /^https?:\/\/\S+$/.test(selected);
  const label = isUrl ? "link text" : selected || "link text";
  const url = isUrl ? selected : "https://";
  const snippet = `[${label}](${url})`;
  const next = value.slice(0, sel.start) + snippet + value.slice(sel.end);
  // Select the part the author most likely needs to type next.
  if (isUrl || !selected) {
    const start = sel.start + 1;
    return { value: next, selection: { start, end: start + label.length } };
  }
  const start = sel.start + label.length + 3;
  return { value: next, selection: { start, end: start + url.length } };
}

function insertCode(value: string, sel: Selection): EditResult {
  const selected = value.slice(sel.start, sel.end);
  const lineStart = value.lastIndexOf("\n", sel.start - 1) + 1;
  const onEmptyLine = !selected && value.slice(lineStart, value.indexOf("\n", sel.start) === -1 ? value.length : value.indexOf("\n", sel.start)).trim() === "";
  if (selected.includes("\n") || onEmptyLine) {
    const body = selected || "code";
    const needsLeadingBreak = sel.start > 0 && value[sel.start - 1] !== "\n";
    const snippet = `${needsLeadingBreak ? "\n" : ""}\`\`\`\n${body}\n\`\`\`\n`;
    const next = value.slice(0, sel.start) + snippet + value.slice(sel.end);
    const start = sel.start + (needsLeadingBreak ? 1 : 0) + 4;
    return { value: next, selection: { start, end: start + body.length } };
  }
  return wrapSelection(value, sel, "`", "`", "code");
}

interface Tool {
  label: string;
  /** Ctrl/Cmd + key shortcut. */
  key?: string;
  icon: ReactNode;
  transform: (value: string, sel: Selection) => EditResult;
}

const TOOLS: Tool[] = [
  { label: "Bold", key: "b", icon: <EditorIcon.Bold className="size-4" />, transform: (v, s) => wrapSelection(v, s, "**", "**", "bold text") },
  { label: "Italic", key: "i", icon: <EditorIcon.Italic className="size-4" />, transform: (v, s) => wrapSelection(v, s, "_", "_", "italic text") },
  { label: "Heading", icon: <EditorIcon.Heading className="size-4" />, transform: (v, s) => prefixLines(v, s, "heading") },
  { label: "Bulleted list", icon: <EditorIcon.BulletList className="size-4" />, transform: (v, s) => prefixLines(v, s, "bullet") },
  { label: "Numbered list", icon: <EditorIcon.NumberedList className="size-4" />, transform: (v, s) => prefixLines(v, s, "numbered") },
  { label: "Quote", icon: <EditorIcon.Quote className="size-4" />, transform: (v, s) => prefixLines(v, s, "quote") },
  { label: "Link", key: "k", icon: <Icon.Link className="size-4" />, transform: insertLink },
  { label: "Code", key: "e", icon: <Icon.Code className="size-4" />, transform: insertCode },
];

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

/**
 * Markdown textarea with a formatting toolbar (bold, italic, heading, lists,
 * quote, link, code) and a Write / Preview toggle. Output is plain markdown
 * rendered everywhere with `<Markdown>`.
 */
export function MarkdownEditor({
  id,
  name,
  value,
  onChange,
  placeholder = "Write in Markdown…",
  rows = 8,
  invalid,
  disabled,
  className,
  describedBy,
  ariaLabel,
  autoFocus,
  compact,
}: MarkdownEditorProps) {
  const autoId = useId();
  const textareaId = id ?? `md-${autoId}`;
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<Selection | null>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");

  useLayoutEffect(() => {
    const sel = pendingSelection.current;
    const el = ref.current;
    if (!sel || !el) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(sel.start, sel.end);
  }, [value]);

  const apply = (fn: (value: string, sel: Selection) => EditResult) => {
    const el = ref.current;
    if (!el || disabled) return;
    const result = fn(value, { start: el.selectionStart, end: el.selectionEnd });
    pendingSelection.current = result.selection;
    onChange(result.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
    if (tool) {
      e.preventDefault();
      apply(tool.transform);
    }
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-surface-1 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25",
        invalid ? "border-danger" : "border-border-strong",
        disabled && "opacity-60",
        className,
      )}
    >
      {name && <input type="hidden" name={name} value={value} />}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-1.5 py-1">
        <div role="toolbar" aria-label="Formatting" aria-controls={textareaId} className="no-scrollbar flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {TOOLS.map((t, i) => (
            <button
              key={t.label}
              type="button"
              onClick={() => apply(t.transform)}
              disabled={disabled || mode === "preview"}
              title={t.key ? `${t.label} (Ctrl+${t.key.toUpperCase()})` : t.label}
              aria-label={t.label}
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-40",
                compact && i > 5 && "hidden sm:inline-flex",
              )}
            >
              {t.icon}
            </button>
          ))}
        </div>
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={setMode}
          options={[
            { value: "write", label: "Write" },
            { value: "preview", label: "Preview" },
          ]}
        />
      </div>
      {mode === "write" ? (
        <textarea
          ref={ref}
          id={textareaId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          spellCheck
          className="block w-full resize-y bg-transparent px-3 py-2.5 font-mono text-[13px] leading-relaxed text-ink placeholder:font-sans placeholder:text-ink-faint focus:outline-none"
        />
      ) : (
        <div className="max-h-[32rem] min-h-24 overflow-y-auto px-4 py-3" style={{ minHeight: `${Math.max(3, rows) * 1.5}rem` }}>
          {value.trim() ? <Markdown content={value} /> : <p className="text-sm italic text-ink-faint">Nothing to preview yet.</p>}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border px-3 py-1 text-[11px] text-ink-faint">
        <span>Markdown supported</span>
        <span className="tabular-nums">{formatNumber(value.length)} characters</span>
      </div>
    </div>
  );
}
