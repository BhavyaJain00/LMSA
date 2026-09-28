"use client";

import { useId, useRef, useState } from "react";
import { Markdown } from "@/lib/markdown";
import { SegmentedControl } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Mode = "write" | "preview";

const TOOLBAR: { label: string; title: string; before: string; after?: string; block?: boolean }[] = [
  { label: "B", title: "Bold", before: "**", after: "**" },
  { label: "I", title: "Italic", before: "_", after: "_" },
  { label: "H", title: "Heading", before: "## ", block: true },
  { label: "•", title: "Bulleted list", before: "- ", block: true },
  { label: "1.", title: "Numbered list", before: "1. ", block: true },
  { label: "</>", title: "Inline code", before: "`", after: "`" },
  { label: "Link", title: "Link", before: "[", after: "](https://)" },
];

/**
 * Markdown textarea with a small formatting toolbar and a Write / Preview
 * toggle. Uncontrolled from the form's point of view: the textarea carries
 * `name`, so it submits with the surrounding form.
 */
export function MarkdownField({
  name,
  id,
  defaultValue = "",
  rows = 10,
  placeholder,
  invalid,
  onChange,
  className,
}: {
  name: string;
  id?: string;
  defaultValue?: string;
  rows?: number;
  placeholder?: string;
  invalid?: boolean;
  onChange?: (value: string) => void;
  className?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<Mode>("write");
  const [value, setValue] = useState(defaultValue);

  const update = (next: string) => {
    setValue(next);
    onChange?.(next);
  };

  const apply = (tool: (typeof TOOLBAR)[number]) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    let next: string;
    let cursor: number;
    if (tool.block) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      next = value.slice(0, lineStart) + tool.before + value.slice(lineStart);
      cursor = end + tool.before.length;
    } else {
      const text = selected || tool.title.toLowerCase();
      next = value.slice(0, start) + tool.before + text + (tool.after ?? "") + value.slice(end);
      cursor = start + tool.before.length + text.length;
    }
    update(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-surface-1 focus-within:ring-2",
        invalid ? "border-danger focus-within:ring-danger/25" : "border-border-strong focus-within:border-accent focus-within:ring-accent/25",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-2 py-1.5">
        <div className={cn("flex flex-wrap items-center gap-0.5", mode === "preview" && "invisible")} aria-hidden={mode === "preview"}>
          {TOOLBAR.map((tool) => (
            <button
              key={tool.title}
              type="button"
              title={tool.title}
              aria-label={tool.title}
              onClick={() => apply(tool)}
              className="min-w-7 rounded-md px-1.5 py-1 font-mono text-xs font-semibold text-ink-muted hover:bg-surface-3 hover:text-ink"
            >
              {tool.label}
            </button>
          ))}
        </div>
        <SegmentedControl<Mode>
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
        id={inputId}
        name={name}
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(e) => update(e.target.value)}
        className={cn(
          "block w-full resize-y bg-surface-1 px-3 py-2 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none",
          mode === "preview" && "hidden",
        )}
      />
      {mode === "preview" && (
        <div className="max-h-128 min-h-40 overflow-y-auto px-4 py-3">
          {value.trim() ? <Markdown content={value} /> : <p className="text-sm italic text-ink-faint">Nothing to preview yet.</p>}
        </div>
      )}
    </div>
  );
}
