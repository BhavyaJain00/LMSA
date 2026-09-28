"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Markdown } from "@/lib/markdown";
import { Icon } from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Mode = "write" | "preview";

function Glyph({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex size-4 items-center justify-center text-[13px] leading-none", className)}>{children}</span>;
}

function ListIcon({ ordered }: { ordered?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true">
      <path d="M9 6h11M9 12h11M9 18h11" />
      {ordered ? (
        <path d="M4 5h1v3M4 11.5h1.8L4 14h2M4 17h2v3H4" strokeWidth={1.3} />
      ) : (
        <>
          <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 17c-1.5 0-2.5-1.2-2.5-3V11c0-2.5 1.5-4 4-4.5M15 17c-1.5 0-2.5-1.2-2.5-3V11c0-2.5 1.5-4 4-4.5" />
    </svg>
  );
}

type ToolId = "bold" | "italic" | "heading" | "bullets" | "numbers" | "quote" | "link" | "code" | "codeblock";

const TOOLS: { id: ToolId; label: string; icon: ReactNode }[] = [
  { id: "bold", label: "Bold", icon: <Glyph className="font-bold">B</Glyph> },
  { id: "italic", label: "Italic", icon: <Glyph className="font-serif italic">I</Glyph> },
  { id: "heading", label: "Heading", icon: <Glyph className="font-semibold">H</Glyph> },
  { id: "bullets", label: "Bulleted list", icon: <ListIcon /> },
  { id: "numbers", label: "Numbered list", icon: <ListIcon ordered /> },
  { id: "quote", label: "Quote", icon: <QuoteIcon /> },
  { id: "link", label: "Link", icon: <Icon.Link className="size-4" /> },
  { id: "code", label: "Inline code", icon: <Icon.Code className="size-4" /> },
  { id: "codeblock", label: "Code block", icon: <Icon.Terminal className="size-4" /> },
];

export interface MarkdownEditorProps {
  name: string;
  id?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  rows?: number;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  /** Accessible label when there is no visible <label for>. */
  ariaLabel?: string;
  className?: string;
  /** Keyboard shortcut handler for Ctrl/Cmd+S etc. is left to the parent form. */
  describedBy?: string;
}

/**
 * Markdown textarea with a formatting toolbar and a Write / Preview toggle.
 * The textarea stays in the DOM in preview mode so the value is submitted.
 */
export function MarkdownEditor({
  name,
  id,
  defaultValue = "",
  value,
  onChange,
  placeholder,
  rows = 8,
  invalid,
  disabled,
  required,
  ariaLabel,
  className,
  describedBy,
}: MarkdownEditorProps) {
  const autoId = useId();
  const fieldId = id ?? `md-${autoId}`;
  const [inner, setInner] = useState(defaultValue);
  const [mode, setMode] = useState<Mode>("write");
  const ref = useRef<HTMLTextAreaElement>(null);
  const current = value ?? inner;

  const set = (next: string) => {
    if (value === undefined) setInner(next);
    onChange?.(next);
  };

  const restoreSelection = (start: number, end: number) => {
    const el = ref.current;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = start;
      el.selectionEnd = end;
    });
  };

  const wrap = (before: string, after = before, fallback = "text") => {
    const el = ref.current;
    if (!el || disabled) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = current.slice(s, e) || fallback;
    const next = current.slice(0, s) + before + selected + after + current.slice(e);
    set(next);
    restoreSelection(s + before.length, s + before.length + selected.length);
  };

  const prefixLines = (prefix: (index: number) => string) => {
    const el = ref.current;
    if (!el || disabled) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const lineStart = current.lastIndexOf("\n", s - 1) + 1;
    const lineEnd = current.indexOf("\n", e);
    const blockEnd = lineEnd === -1 ? current.length : lineEnd;
    const block = current.slice(lineStart, blockEnd);
    const changed = block
      .split("\n")
      .map((line, i) => prefix(i) + line)
      .join("\n");
    set(current.slice(0, lineStart) + changed + current.slice(blockEnd));
    restoreSelection(lineStart, lineStart + changed.length);
  };

  const insertLink = () => {
    const el = ref.current;
    if (!el || disabled) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const label = current.slice(s, e) || "link text";
    const snippet = `[${label}](https://)`;
    set(current.slice(0, s) + snippet + current.slice(e));
    const urlStart = s + label.length + 3;
    restoreSelection(urlStart, urlStart + "https://".length);
  };

  const insertCodeBlock = () => {
    const el = ref.current;
    if (!el || disabled) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = current.slice(s, e) || "code";
    const needsBreak = s > 0 && current[s - 1] !== "\n";
    const snippet = `${needsBreak ? "\n" : ""}\`\`\`\n${selected}\n\`\`\`\n`;
    set(current.slice(0, s) + snippet + current.slice(e));
    const start = s + (needsBreak ? 1 : 0) + 4;
    restoreSelection(start, start + selected.length);
  };

  const runTool = (tool: ToolId) => {
    switch (tool) {
      case "bold":
        return wrap("**", "**", "bold text");
      case "italic":
        return wrap("_", "_", "italic text");
      case "heading":
        return prefixLines(() => "## ");
      case "bullets":
        return prefixLines(() => "- ");
      case "numbers":
        return prefixLines((i) => `${i + 1}. `);
      case "quote":
        return prefixLines(() => "> ");
      case "link":
        return insertLink();
      case "code":
        return wrap("`", "`", "code");
      case "codeblock":
        return insertCodeBlock();
    }
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-surface-1 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25",
        invalid ? "border-danger" : "border-border-strong",
        disabled && "opacity-70",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-2 py-1.5">
        <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => runTool(t.id)}
              disabled={disabled || mode === "preview"}
              title={t.label}
              aria-label={t.label}
              className="inline-flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-40"
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
      <textarea
        ref={ref}
        id={fieldId}
        name={name}
        value={current}
        onChange={(e) => set(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(
          "block w-full resize-y bg-transparent px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none",
          mode === "preview" && "hidden",
        )}
      />
      {mode === "preview" && (
        <div className="min-h-32 px-4 py-3" aria-live="polite">
          {current.trim() ? <Markdown content={current} /> : <p className="text-sm italic text-ink-faint">Nothing to preview yet.</p>}
        </div>
      )}
      <p className="border-t border-border bg-surface-2/60 px-3 py-1 text-[11px] text-ink-faint">Markdown supported: **bold**, _italic_, lists, links, `code`, tables.</p>
    </div>
  );
}
