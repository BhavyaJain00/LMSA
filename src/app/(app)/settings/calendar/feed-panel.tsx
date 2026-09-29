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
          toast.success(res.message ?? "Saved");
          setConfirm(null);
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error("Something went wrong. Check your connection and try again.");
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
      toast.toast({ title: "Copy the selected link", description: "Your browser blocked automatic copying. Press Ctrl+C (or ⌘C) to copy it.", tone: "info" });
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
            <p className="text-sm font-medium text-ink">Your calendar feed is off</p>
            <p className="mt-0.5 text-sm text-ink-muted">Create a private link to add your schedule to Google Calendar, Apple Calendar or Outlook.</p>
          </div>
        </div>
        <Button
          onClick={() => run("enable", enableCalendarFeedAction)}
          loading={pending === "enable"}
          leftIcon={<Icon.Link className="size-4" />}
          className="w-full sm:w-auto"
        >
          Create my calendar link
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
          Your private calendar link
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            ref={inputRef}
            id="calendar-feed-url"
            readOnly
            value={feedUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
            aria-describedby="calendar-feed-hint"
            spellCheck={false}
          />
          <Button
            variant={copied ? "subtle" : "primary"}
            onClick={() => void copy()}
            leftIcon={copied ? <Icon.Check className="size-4" /> : <Icon.Copy className="size-4" />}
            className="sm:w-28"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p id="calendar-feed-hint" className="mt-1.5 text-xs text-ink-muted" aria-live="polite">
          {copied ? "Link copied. Paste it into your calendar app's “Subscribe” or “From URL” option." : "Keep this link to yourself: it works without signing in."}
        </p>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-ink">Subscribe with one click</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <a href={webcal} className={subscribeClass}>
            <Icon.Calendar className="size-4" />
            <span className="min-w-0 truncate">Calendar app (Apple, Outlook)</span>
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
            This site isn&apos;t on a public address, so Google and Microsoft can&apos;t fetch the feed from their servers. The calendar app option
            and the download below work from this device.
          </p>
        )}
        <a href={downloadUrl} download className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
          <Icon.Download className="size-4" />
          Download a one-time copy (.ics)
        </a>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-muted">Shared this link by accident? Create a new one and the old link stops working.</p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setConfirm("regenerate")} disabled={pending !== null} leftIcon={<Icon.Refresh className="size-4" />}>
            New link
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirm("disable")} disabled={pending !== null} className="text-danger hover:bg-danger/10">
            Turn off
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "regenerate"}
        onClose={() => pending === null && setConfirm(null)}
        onConfirm={() => run("regenerate", regenerateCalendarFeedAction)}
        loading={pending === "regenerate"}
        title="Create a new calendar link?"
        description="Calendars subscribed with your current link stop updating. You'll need to subscribe again with the new link on every device."
        confirmLabel="Create new link"
        cancelLabel="Keep current link"
      />
      <ConfirmDialog
        open={confirm === "disable"}
        onClose={() => pending === null && setConfirm(null)}
        onConfirm={() => run("disable", disableCalendarFeedAction)}
        loading={pending === "disable"}
        destructive
        title="Turn off your calendar feed?"
        description="Your current link stops working right away and subscribed calendars stop receiving updates. You can create a new link at any time."
        confirmLabel="Turn off"
        cancelLabel="Keep it on"
      />
    </div>
  );
}
