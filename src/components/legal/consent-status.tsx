"use client";

import { useSyncExternalStore } from "react";
import { getConsent, onConsentChange, openConsentSettings, type ConsentState } from "./consent-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

/** Cached snapshot so `useSyncExternalStore` sees a stable value between changes. */
let snapshot: ConsentState | null = null;
let snapshotKey = "";

function read(): ConsentState {
  const next = getConsent();
  const key = `${next.decided}:${next.analytics}:${next.marketing}`;
  if (!snapshot || key !== snapshotKey) {
    snapshot = next;
    snapshotKey = key;
  }
  return snapshot;
}

function subscribe(callback: () => void): () => void {
  return onConsentChange(() => callback());
}

/**
 * The visitor's current cookie choice, kept live when it changes in the
 * consent dialog (this tab or another one), with a button that reopens it.
 * `initial` is the server's reading of the same cookie (no flash on load).
 */
export function ConsentStatus({ initial }: { initial: ConsentState }) {
  const state = useSyncExternalStore(subscribe, read, () => initial);
  const rows: { label: string; description: string; on: boolean; fixed?: boolean }[] = [
    { label: "Necessary", description: "Sign-in, security and your preferences. Always on.", on: true, fixed: true },
    { label: "Analytics", description: "Anonymous statistics that help us improve the site.", on: state.analytics },
    { label: "Marketing", description: "Measuring ads and campaigns that brought you here.", on: state.marketing },
  ];

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((row) => (
          <li key={row.label} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{row.label}</p>
              <p className="text-xs text-ink-muted">{row.description}</p>
            </div>
            <Badge tone={row.fixed ? "neutral" : row.on ? "success" : "neutral"} dot className="shrink-0">
              {row.fixed ? "Required" : row.on ? "Allowed" : "Off"}
            </Badge>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted" aria-live="polite">
          {state.decided ? "Your choice is stored in this browser for a year." : "You haven't made a choice in this browser yet, so only necessary cookies are used."}
        </p>
        <Button variant="outline" size="sm" onClick={openConsentSettings} aria-haspopup="dialog" leftIcon={<Icon.Sliders className="size-4" />} className="self-start sm:self-auto">
          Change cookie settings
        </Button>
      </div>
    </div>
  );
}
