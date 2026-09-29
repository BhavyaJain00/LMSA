"use client";

import { useCallback, useEffect, useState, useTransition, type ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { getStandalone } from "./install-store";

interface WorkerStatus {
  version: string;
  offlinePage: boolean;
  shellAt: number;
  counts: Record<string, number>;
}

interface Snapshot {
  supported: boolean;
  production: boolean;
  registration: "none" | "installing" | "waiting" | "active";
  controlled: boolean;
  standalone: boolean;
  worker: WorkerStatus | null;
  usage: number | null;
  quota: number | null;
}

type State = { status: "loading" } | { status: "ready"; data: Snapshot };

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function ask<T>(worker: ServiceWorker, message: object, timeoutMs = 4000): Promise<T | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (e) => {
      window.clearTimeout(timer);
      resolve(e.data as T);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

async function readSnapshot(): Promise<Snapshot> {
  const supported = "serviceWorker" in navigator;
  const base: Snapshot = {
    supported,
    production: IS_PRODUCTION,
    registration: "none",
    controlled: false,
    standalone: getStandalone(),
    worker: null,
    usage: null,
    quota: null,
  };
  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      base.usage = estimate.usage ?? null;
      base.quota = estimate.quota ?? null;
    } catch {
      /* not available in this context */
    }
  }
  if (!supported) return base;
  const reg = await navigator.serviceWorker.getRegistration("/");
  base.controlled = !!navigator.serviceWorker.controller;
  if (!reg) return base;
  base.registration = reg.waiting ? "waiting" : reg.active ? "active" : reg.installing ? "installing" : "none";
  if (reg.active) base.worker = await ask<WorkerStatus>(reg.active, { type: "GET_STATUS" });
  return base;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

const registrationLabel: Record<Snapshot["registration"], { label: string; tone: BadgeTone }> = {
  none: { label: "Not installed", tone: "neutral" },
  installing: { label: "Installing", tone: "info" },
  waiting: { label: "Update waiting", tone: "warning" },
  active: { label: "Active", tone: "success" },
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-ink">{children}</dd>
    </div>
  );
}

/**
 * "This browser" panel for admins testing the installable app: service
 * worker state, cached entries and storage use, with update and clear actions.
 */
export function PwaDiagnostics({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const [state, setState] = useState<State>({ status: "loading" });
  const [busy, startTransition] = useTransition();

  const refresh = useCallback(() => {
    return readSnapshot()
      .then((data) => setState({ status: "ready", data }))
      .catch(() =>
        setState({
          status: "ready",
          data: { supported: false, production: IS_PRODUCTION, registration: "none", controlled: false, standalone: false, worker: null, usage: null, quota: null },
        }),
      );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const checkUpdate = () =>
    startTransition(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/");
      if (!reg) {
        toast.error("No service worker is installed in this browser");
        return;
      }
      try {
        await reg.update();
        toast.success(reg.installing || reg.waiting ? "An update was found" : "You're on the latest version");
      } catch {
        toast.error("Couldn't check for updates. Are you online?");
      }
      await refresh();
    });

  const clearData = () =>
    startTransition(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/");
      if (reg?.active) {
        await ask(reg.active, { type: "CLEAR_CACHES" }, 15000);
      } else if ("caches" in window) {
        for (const key of await caches.keys()) if (key.startsWith("ll-")) await caches.delete(key);
      }
      toast.success("Offline data cleared on this device");
      await refresh();
    });

  if (state.status === "loading") {
    return (
      <div className="space-y-3 p-5" aria-busy="true">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    );
  }

  const data = state.data;
  if (!data.supported) {
    return <p className="px-4 py-4 text-sm text-ink-muted sm:px-5">This browser doesn&apos;t support service workers, so it can&apos;t install the app or work offline.</p>;
  }

  const reg = registrationLabel[data.registration];
  const cached = data.worker ? Object.values(data.worker.counts).reduce((a, b) => a + b, 0) : null;

  return (
    <div>
      {!data.production && (
        <p className="flex items-start gap-2 border-b border-border bg-info/5 px-4 py-3 text-xs text-ink sm:px-5">
          <Icon.Info className="mt-0.5 size-3.5 shrink-0 text-info" />
          This is a development build: the service worker is not registered (and any old one is removed) so code changes always show up. Use a
          production build to test installation and offline mode.
        </p>
      )}
      {data.production && !enabled && data.registration !== "none" && (
        <p className="flex items-start gap-2 border-b border-border bg-warning/5 px-4 py-3 text-xs text-ink sm:px-5">
          <Icon.AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          The app is turned off; this browser removes its service worker on the next page load.
        </p>
      )}
      <dl className="divide-y divide-border">
        <Row label="Service worker">
          <Badge tone={reg.tone} dot>
            {reg.label}
          </Badge>
        </Row>
        <Row label="Version">{data.worker?.version ?? "—"}</Row>
        <Row label="This page is controlled">{data.controlled ? "Yes" : "No"}</Row>
        <Row label="Running as installed app">{data.standalone ? "Yes" : "No"}</Row>
        <Row label="Cached entries">
          {cached === null
            ? "—"
            : `${cached} (${data.worker!.counts.pages ?? 0} pages, ${data.worker!.counts.images ?? 0} images, ${(data.worker!.counts.static ?? 0) + (data.worker!.counts.shell ?? 0)} files)`}
        </Row>
        <Row label="Storage used by this site">
          {formatBytes(data.usage)}
          {data.quota ? <span className="text-ink-faint"> of {formatBytes(data.quota)}</span> : null}
        </Row>
      </dl>
      <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3 sm:px-5">
        <Button size="sm" variant="outline" onClick={checkUpdate} disabled={busy || data.registration === "none"} leftIcon={<Icon.Refresh className="size-4" />}>
          Check for updates
        </Button>
        <Button size="sm" variant="ghost" onClick={clearData} disabled={busy} leftIcon={<Icon.Trash className="size-4" />}>
          Clear offline data
        </Button>
      </div>
    </div>
  );
}
