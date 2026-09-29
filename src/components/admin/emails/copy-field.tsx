"use client";

import { useState } from "react";
import { IconButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/** Read-only secret value with reveal and copy buttons (e.g. the cron URL). */
export function CopyField({ value, label, secret = false }: { value: string; label: string; secret?: boolean }) {
  const toast = useToast();
  const [revealed, setRevealed] = useState(!secret);
  const shown = revealed ? value : value.replace(/key=[^&]+/, "key=••••••••••••••••");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Couldn't copy to the clipboard");
    }
  };

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border-strong bg-surface-2 py-1 pl-3 pr-1">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={revealed ? value : undefined} aria-label={label}>
        {shown}
      </code>
      {secret && (
        <IconButton label={revealed ? `Hide ${label}` : `Show ${label}`} size="icon-sm" onClick={() => setRevealed((v) => !v)}>
          {revealed ? <Icon.EyeOff className="size-4" /> : <Icon.Eye className="size-4" />}
        </IconButton>
      )}
      <IconButton label={`Copy ${label}`} size="icon-sm" onClick={copy}>
        <Icon.Copy className="size-4" />
      </IconButton>
    </div>
  );
}
