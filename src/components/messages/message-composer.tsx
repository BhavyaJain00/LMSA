"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { MESSAGE_LIMITS } from "@/lib/comms/messages-core";

const MAX_HEIGHT_PX = 192;

function readDraft(key: string | undefined): string {
  if (!key) return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(key: string | undefined, value: string): void {
  if (!key) return;
  try {
    if (value.trim()) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Drafts are a convenience; private windows may block storage.
  }
}

/**
 * Message box: Enter sends, Shift+Enter adds a new line (IME composition is
 * respected), grows with its content, keeps an unsent draft per conversation
 * in this browser, and shows a counter near the length limit.
 * `onSend` resolves to true when the text was accepted (the box is cleared).
 */
export function MessageComposer({
  onSend,
  disabled = false,
  placeholder = "Write a message…",
  draftKey,
  autoFocus = false,
  submitLabel = "Send",
  className,
}: {
  onSend: (body: string) => Promise<boolean> | boolean;
  disabled?: boolean;
  placeholder?: string;
  /** localStorage key for the unsent draft. */
  draftKey?: string;
  autoFocus?: boolean;
  submitLabel?: string;
  className?: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  // Restore the draft after hydration (storage is not available on the server).
  useEffect(() => {
    const draft = readDraft(draftKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from browser storage
    if (draft) setValue(draft);
  }, [draftKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const length = value.trim().length;
  const tooLong = length > MESSAGE_LIMITS.bodyMax;
  const canSend = !disabled && !busy && length > 0 && !tooLong;

  const submit = async () => {
    if (!canSend) return;
    const body = value;
    setBusy(true);
    try {
      const accepted = await onSend(body);
      if (accepted) {
        setValue("");
        writeDraft(draftKey, "");
      }
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void submit();
  };

  return (
    <form
      className={cn("flex flex-col gap-1.5", className)}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-end gap-2 rounded-card border border-border bg-surface-1 p-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            writeDraft(draftKey, e.target.value);
          }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder}
          aria-label="Message"
          aria-describedby={hintId}
          aria-invalid={tooLong || undefined}
          disabled={disabled}
          autoFocus={autoFocus}
          maxLength={MESSAGE_LIMITS.bodyMax + 500}
          className="max-h-48 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed"
        />
        <Button type="submit" size="sm" disabled={!canSend} loading={busy} leftIcon={<Icon.Send className="size-4" />} aria-label={submitLabel}>
          <span className="hidden sm:inline">{submitLabel}</span>
        </Button>
      </div>
      <div id={hintId} className="flex items-center justify-between gap-3 px-1 text-[11px] text-ink-faint">
        <span className="hidden sm:inline">
          <kbd className="font-sans font-medium">Enter</kbd> to send · <kbd className="font-sans font-medium">Shift+Enter</kbd> for a new line · **bold**, *italic*, `code`
        </span>
        <span className="sm:hidden">Enter sends · Shift+Enter adds a line</span>
        {length > MESSAGE_LIMITS.bodyMax * 0.8 && (
          <span className={cn("tabular-nums", tooLong && "font-medium text-danger")} aria-live="polite">
            {length.toLocaleString()} / {MESSAGE_LIMITS.bodyMax.toLocaleString()}
          </span>
        )}
      </div>
    </form>
  );
}
