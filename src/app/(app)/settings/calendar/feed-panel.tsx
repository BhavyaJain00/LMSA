"use client";

import { useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import { disableCalendarFeedAction, enableCalendarFeedAction, regenerateCalendarFeedAction, type CalendarFeedInfo } from "@/lib/actions/calendar";
import { googleSubscribeUrl, outlookSubscribeUrl, toWebcalUrl } from "@/lib/calendar/links";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PwaIcon } from "@/components/pwa/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

type Pending = "enable" | "regenerate" | "disable" | null;

/**
 * Private feed link with copy, one-click subscribe buttons for the common
 * calendar apps, and "regenerate" / "turn off" (both confirmed, because they
 * break existing subscriptions).
 */
export function FeedPanel({
  initialFeedUrl,
  calendarName,
  publiclyReachable,
}: {
  initialFeedUrl: string | null;
  calendarName: string;
  publiclyReachable: boolean;
}) {
  const toast = useToast();
  const t = useT("account");
  const tc = useT("common");
  const [feedUrl, setFeedUrl] = useState(initialFeedUrl);
  const [confirm, setConfirm] = useState<"regenerate" | "disable" | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<number | null>(null);

  const run = (kind: Exclude<Pending, null>, action: () => Promise<ActionResult<CalendarFeedInfo>>) => {
    setPending(kind);
    startTransition(async () => {
      try {
        const res = await action();
        if (res.ok) {
          setFeedUrl(res.data.feedUrl);
          setCopied(false);
          toast.success(res.message ?? t("settings.calendar.feed.saved"));
          setConfirm(null);
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error(tc("errors.network"));
      } finally {
        setPending(null);
      }
    });
  };

  const copy = async () => {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2500);
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      toast.toast({ title: t("settings.calendar.feed.copyFallbackTitle"), description: t("settings.calendar.feed.copyFallbackBody"), tone: "info" });
    }
  };

  if (!feedUrl) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-border-strong px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <PwaIcon.CalendarSync className="size-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-ink">{t("settings.calendar.feed.offTitle")}</p>
            <p className="mt-0.5 text-sm text-ink-muted">{t("settings.calendar.feed.offBody")}</p>
          </div>
        </div>
        <Button
          onClick={() => run("enable", enableCalendarFeedAction)}
          loading={pending === "enable"}
          leftIcon={<Icon.Link className="size-4" />}
          className="w-full sm:w-auto"
        >
          {t("settings.calendar.feed.create")}
        </Button>
      </div>
    );
  }

  const webcal = toWebcalUrl(feedUrl);
  const downloadUrl = `${feedUrl}?download=1`;
  const external = { target: "_blank", rel: "noopener noreferrer" } as const;
  const subscribeClass = buttonClasses({ variant: "outline", size: "sm", className: "justify-start" });

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="calendar-feed-url" className="mb-1.5 block text-sm font-medium text-ink">
          {t("settings.calendar.feed.linkLabel")}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            ref={inputRef}
            id="calendar-feed-url"
            readOnly
            value={feedUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
            dir="ltr"
            aria-describedby="calendar-feed-hint"
            spellCheck={false}
          />
          <Button
            variant={copied ? "subtle" : "primary"}
            onClick={() => void copy()}
            leftIcon={copied ? <Icon.Check className="size-4" /> : <Icon.Copy className="size-4" />}
            className="sm:w-28"
          >
            {copied ? tc("actions.copied") : tc("actions.copy")}
          </Button>
        </div>
        <p id="calendar-feed-hint" className="mt-1.5 text-xs text-ink-muted" aria-live="polite">
          {copied ? t("settings.calendar.feed.copiedHint") : t("settings.calendar.feed.keepPrivate")}
        </p>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-ink">{t("settings.calendar.feed.oneClick")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <a href={webcal} className={subscribeClass}>
            <Icon.Calendar className="size-4" />
            <span className="min-w-0 truncate">{t("settings.calendar.feed.calendarApp")}</span>
          </a>
          <a href={googleSubscribeUrl(feedUrl)} {...external} className={cn(subscribeClass, !publiclyReachable && "opacity-60")}>
            <Icon.ExternalLink className="size-4" />
            <span className="min-w-0 truncate">Google Calendar</span>
          </a>
          <a href={outlookSubscribeUrl(feedUrl, calendarName)} {...external} className={cn(subscribeClass, !publiclyReachable && "opacity-60")}>
            <Icon.ExternalLink className="size-4" />
            <span className="min-w-0 truncate">Outlook.com</span>
          </a>
          <a
            href={outlookSubscribeUrl(feedUrl, calendarName, "outlook.office.com")}
            {...external}
            className={cn(subscribeClass, !publiclyReachable && "opacity-60")}
          >
            <Icon.ExternalLink className="size-4" />
            <span className="min-w-0 truncate">Microsoft 365</span>
          </a>
        </div>
        {!publiclyReachable && (
          <p className="mt-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-ink">
            <Icon.AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            {t("settings.calendar.feed.notReachable")}
          </p>
        )}
        <a href={downloadUrl} download className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
          <Icon.Download className="size-4" />
          {t("settings.calendar.feed.download")}
        </a>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-muted">{t("settings.calendar.feed.sharedByAccident")}</p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setConfirm("regenerate")} disabled={pending !== null} leftIcon={<Icon.Refresh className="size-4" />}>
            {t("settings.calendar.feed.newLink")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirm("disable")} disabled={pending !== null} className="text-danger hover:bg-danger/10">
            {t("settings.calendar.feed.turnOff")}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "regenerate"}
        onClose={() => pending === null && setConfirm(null)}
        onConfirm={() => run("regenerate", regenerateCalendarFeedAction)}
        loading={pending === "regenerate"}
        title={t("settings.calendar.feed.regenTitle")}
        description={t("settings.calendar.feed.regenBody")}
        confirmLabel={t("settings.calendar.feed.regenConfirm")}
        cancelLabel={t("settings.calendar.feed.regenCancel")}
      />
      <ConfirmDialog
        open={confirm === "disable"}
        onClose={() => pending === null && setConfirm(null)}
        onConfirm={() => run("disable", disableCalendarFeedAction)}
        loading={pending === "disable"}
        destructive
        title={t("settings.calendar.feed.disableTitle")}
        description={t("settings.calendar.feed.disableBody")}
        confirmLabel={t("settings.calendar.feed.turnOff")}
        cancelLabel={t("settings.calendar.feed.disableCancel")}
      />
    </div>
  );
}
