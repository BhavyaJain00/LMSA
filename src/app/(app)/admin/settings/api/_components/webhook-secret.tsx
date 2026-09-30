"use client";

import { CopyButton } from "@/components/developers/copy-button";

/** A signing secret with a copy button (shown after creating an endpoint, revealing or rolling its secret). */
export function SecretValue({ secret, label = "Signing secret" }: { secret: string; label?: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-ink" aria-label={label}>
        {secret}
      </code>
      <CopyButton value={secret} label="Copy secret" />
    </div>
  );
}
