"use client";

import { type CampaignKind, placeholdersFor } from "@/lib/comms/campaign-core";
import { cn } from "@/lib/utils";

/**
 * Insert `token` where the caret is in the field with id `fieldId` (at the
 * end when the field isn't on screen, e.g. while the editor shows its
 * preview) and return the new value. The caret is put back after the token
 * once React has rendered the value.
 */
export function insertAtCaret(fieldId: string, current: string, token: string): string {
  const el = document.getElementById(fieldId);
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    return current && !/\s$/.test(current) ? `${current} ${token}` : `${current}${token}`;
  }
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? start;
  const caret = start + token.length;
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(caret, caret);
  });
  return current.slice(0, start) + token + current.slice(end);
}

/**
 * The personalization placeholders an author can use, as buttons that insert
 * `{{ key }}` into the field that was edited last.
 */
export function PlaceholderBar({ kind, onInsert, disabled, className }: { kind: CampaignKind; onInsert: (token: string) => void; disabled?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} role="group" aria-label="Insert a placeholder">
      <span className="text-xs text-ink-muted">Personalize:</span>
      {placeholdersFor(kind).map((p) => (
        <button
          key={p.key}
          type="button"
          disabled={disabled}
          title={p.description}
          aria-label={`Insert ${p.key.replace(/_/g, " ")}: ${p.description}`}
          onClick={() => onInsert(`{{ ${p.key} }}`)}
          className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted transition-colors hover:border-border-strong hover:text-ink disabled:opacity-50"
        >
          {`{{ ${p.key} }}`}
        </button>
      ))}
    </div>
  );
}
