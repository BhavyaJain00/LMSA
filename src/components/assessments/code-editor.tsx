"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

const LINE_HEIGHT = 20;
const PADDING_Y = 12;
const INDENT = "  ";

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** Ctrl/Cmd + Enter */
  onRun?: () => void;
  readOnly?: boolean;
  language?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
  minHeight?: number;
  maxHeight?: number;
  className?: string;
  /** Show the keyboard hint below the editor. */
  showHint?: boolean;
}

/**
 * Lightweight code editor: a monospace textarea with a synced line-number
 * gutter, soft tabs (Tab inserts two spaces, Shift+Tab outdents), automatic
 * indentation on Enter and Ctrl/Cmd+Enter to run. Press Esc, then Tab, to
 * move focus out of the editor.
 */
export function CodeEditor({
  value,
  onChange,
  onRun,
  readOnly = false,
  language,
  id,
  name,
  ariaLabel: ariaLabelProp,
  minHeight = 280,
  maxHeight = 1000,
  className,
  showHint = true,
}: CodeEditorProps) {
  const t = useT("learning");
  const ariaLabel = ariaLabelProp ?? t("global.codeEditor.label");
  const autoId = useId();
  const editorId = id ?? `code-${autoId}`;
  const hintId = `${editorId}-hint`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const escapedRef = useRef(false);

  const lineCount = Math.max(1, value.split("\n").length);
  const height = Math.min(maxHeight, Math.max(minHeight, lineCount * LINE_HEIGHT + PADDING_Y * 2));
  const numbers = Array.from({ length: lineCount }, (_, i) => i + 1).join("\n");

  const commit = (next: string, selectionStart: number, selectionEnd: number) => {
    onChange?.(next);
    const el = textareaRef.current;
    requestAnimationFrame(() => {
      if (!el) return;
      el.selectionStart = selectionStart;
      el.selectionEnd = selectionEnd;
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.key === "Escape") {
      escapedRef.current = true;
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onRun?.();
      return;
    }
    if (e.key === "Tab" && escapedRef.current) {
      // Let focus leave the editor.
      escapedRef.current = false;
      return;
    }
    if (e.key !== "Shift") escapedRef.current = false;
    if (readOnly) return;

    const { selectionStart: start, selectionEnd: end } = el;
    const text = el.value;

    if (e.key === "Tab") {
      e.preventDefault();
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const multiLine = text.slice(start, end).includes("\n");
      if (!e.shiftKey && !multiLine) {
        commit(text.slice(0, start) + INDENT + text.slice(end), start + INDENT.length, start + INDENT.length);
        return;
      }
      // Indent / outdent every selected line.
      const blockEnd = end > start && text[end - 1] === "\n" ? end - 1 : end;
      const block = text.slice(lineStart, blockEnd);
      const lines = block.split("\n");
      let firstDelta = 0;
      let totalDelta = 0;
      const changed = lines.map((line, i) => {
        if (e.shiftKey) {
          const remove = line.startsWith(INDENT) ? INDENT.length : line.startsWith(" ") || line.startsWith("\t") ? 1 : 0;
          if (i === 0) firstDelta = -remove;
          totalDelta -= remove;
          return line.slice(remove);
        }
        if (i === 0) firstDelta = INDENT.length;
        totalDelta += INDENT.length;
        return INDENT + line;
      });
      const next = text.slice(0, lineStart) + changed.join("\n") + text.slice(blockEnd);
      const newStart = Math.max(lineStart, start + firstDelta);
      commit(next, multiLine ? lineStart : newStart, multiLine ? blockEnd + totalDelta : Math.max(lineStart, end + firstDelta));
      return;
    }

    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const line = text.slice(lineStart, start);
      const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
      const opens = /[{[(:]\s*$/.test(line);
      const closes = /^\s*[}\])]/.test(text.slice(end));
      const firstLine = `\n${indent}${opens ? INDENT : ""}`;
      const caret = start + firstLine.length;
      const insert = opens && closes ? `${firstLine}\n${indent}` : firstLine;
      commit(text.slice(0, start) + insert + text.slice(end), caret, caret);
      return;
    }
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className={cn(
          "relative flex overflow-hidden rounded-xl border border-border-strong bg-surface-2 font-mono text-[13px] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25",
          readOnly && "bg-surface-2/70",
        )}
        style={{ height }}
      >
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="no-scrollbar w-11 shrink-0 select-none overflow-hidden border-r border-border bg-surface-3/40 pr-2.5 text-right text-ink-faint"
          style={{ paddingTop: PADDING_Y, paddingBottom: PADDING_Y, lineHeight: `${LINE_HEIGHT}px` }}
        >
          <pre className="m-0 font-mono">{numbers}</pre>
        </div>
        <textarea
          ref={textareaRef}
          id={editorId}
          name={name}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={(e) => {
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          readOnly={readOnly}
          aria-label={ariaLabel}
          aria-describedby={showHint ? hintId : undefined}
          aria-readonly={readOnly || undefined}
          data-language={language}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="scrollbar-thin h-full min-w-0 flex-1 resize-none whitespace-pre bg-transparent px-3 text-ink caret-accent outline-none placeholder:text-ink-faint"
          style={{ paddingTop: PADDING_Y, paddingBottom: PADDING_Y, lineHeight: `${LINE_HEIGHT}px`, tabSize: 2 }}
        />
      </div>
      {showHint && (
        <p id={hintId} className="text-[11px] text-ink-faint">
          {readOnly ? t("global.codeEditor.readOnly") : t("global.codeEditor.hint")}
          {onRun ? ` · ${t("global.codeEditor.runHint")}` : ""}
        </p>
      )}
    </div>
  );
}
