"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { buildIcs, icsFileName } from "@/lib/calendar/ics";
import { googleCalendarUrl, linkDetails, office365Url, outlookComUrl, type CalendarLinkEvent } from "@/lib/calendar/links";
import { useT } from "@/i18n/client";
import { PwaIcon } from "./icons";

export interface AddToCalendarEvent {
  title: string;
  description?: string;
  location?: string;
  /** App path ("/batches/x", or "?tab=classes#class-1" relative to the current page) or absolute URL. */
  url?: string;
  /** Epoch ms (for all-day events: only used for ordering). */
  start: number;
  /** Exclusive end, epoch ms. */
  end: number;
  /** All-day event: first day and EXCLUSIVE end day (YYYY-MM-DD). */
  allDay?: { startDate: string; endDate: string };
  /** Server-generated single-event .ics (e.g. "/api/calendar/event?type=live_class&id=…"). */
  icsHref?: string;
  /** Stable id used when the .ics has to be generated in the browser. */
  uid?: string;
}

interface MenuLink {
  key: string;
  label: string;
  hint: string;
  icon: ReactNode;
  href: string;
  download?: string;
  external?: boolean;
}

/** Resolves app paths ("/x", "?tab=y#z") against the current page. Only http(s) results are kept. */
function absoluteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const resolved = new URL(url, window.location.href);
    return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Local .ics as a data: URL, used when no server download is available. */
function localIcsHref(event: AddToCalendarEvent, pageUrl: string | undefined): string {
  const body = buildIcs({
    prodId: "-//LearnLoop//LMS Calendar 1.0//EN",
    events: [
      {
        uid: `${event.uid ?? `${event.start}-${event.title}`}@${window.location.host}`,
        dtstamp: Date.now(),
        start: event.allDay ? { kind: "date", dateKey: event.allDay.startDate } : { kind: "utc", epochMs: event.start },
        end: event.allDay ? { kind: "date", dateKey: event.allDay.endDate } : { kind: "utc", epochMs: event.end },
        summary: event.title,
        description: linkDetails({ description: event.description, url: pageUrl }),
        location: event.location,
        url: pageUrl,
        status: "CONFIRMED",
      },
    ],
  });
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}

type CalendarT = ReturnType<typeof useT<"account">>;

function buildLinks(event: AddToCalendarEvent, t: CalendarT): MenuLink[] {
  const pageUrl = absoluteUrl(event.url);
  const linkEvent: CalendarLinkEvent = {
    title: event.title,
    description: event.description,
    location: event.location,
    url: pageUrl,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
  };
  return [
    {
      key: "ics",
      label: t("global.calendar.icsLabel"),
      hint: t("global.calendar.icsHint"),
      icon: <Icon.Download />,
      href: event.icsHref ?? localIcsHref(event, pageUrl),
      download: icsFileName(event.title),
    },
    { key: "google", label: "Google Calendar", hint: t("global.calendar.googleHint"), icon: <Icon.ExternalLink />, href: googleCalendarUrl(linkEvent), external: true },
    { key: "outlook", label: "Outlook.com", hint: t("global.calendar.outlookHint"), icon: <Icon.ExternalLink />, href: outlookComUrl(linkEvent), external: true },
    { key: "office", label: "Microsoft 365", hint: t("global.calendar.officeHint"), icon: <Icon.ExternalLink />, href: office365Url(linkEvent), external: true },
  ];
}

/**
 * "Add to calendar" menu: .ics download (Apple Calendar, Outlook desktop and
 * most apps), Google Calendar, Outlook.com and Microsoft 365. Links are built
 * when the menu opens so the page URL can be made absolute in the browser.
 */
export function AddToCalendar({
  event,
  variant = "icon",
  size = "sm",
  label: labelProp,
  align = "end",
  className,
}: {
  event: AddToCalendarEvent;
  variant?: "icon" | "button" | "ghost";
  size?: "xs" | "sm";
  label?: string;
  align?: "start" | "end";
  className?: string;
}) {
  const t = useT("account");
  const label = labelProp ?? t("global.calendar.add");
  const [links, setLinks] = useState<MenuLink[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const menuId = useId();
  const open = links !== null;

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setLinks(null);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  const close = (refocus: boolean) => {
    setLinks(null);
    if (refocus) triggerRef.current?.focus();
  };

  const toggle = () => {
    if (open) close(false);
    else setLinks(buildLinks(event, t));
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((el): el is HTMLAnchorElement => !!el);
    const index = items.findIndex((el) => el === document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const trigger =
    variant === "icon" ? (
      <span className={cn("flex items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink", size === "xs" ? "size-7" : "size-8")}>
        <PwaIcon.CalendarPlus className="size-4" />
      </span>
    ) : (
      <span className={buttonClasses({ variant: variant === "ghost" ? "ghost" : "outline", size })}>
        <PwaIcon.CalendarPlus className="size-4" />
        {label}
        <Icon.ChevronDown className={cn("size-3.5 opacity-70 transition-transform", open && "rotate-180")} />
      </span>
    );

  return (
    <div ref={rootRef} className={cn("relative inline-block", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={variant === "icon" ? t("global.calendar.addNamed", { label, title: event.title }) : undefined}
        title={variant === "icon" ? label : undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setLinks(buildLinks(event, t));
          }
        }}
        className="inline-flex rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {trigger}
      </button>
      {links && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute z-50 mt-1.5 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface-1 p-1 shadow-pop animate-scale-in",
            align === "end" ? "end-0 origin-top-right rtl:origin-top-left" : "start-0 origin-top-left rtl:origin-top-right",
          )}
        >
          <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
          {links.map((link, i) => (
            <a
              key={link.key}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              role="menuitem"
              href={link.href}
              download={link.download}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              onClick={() => close(false)}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm text-ink transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
            >
              <span className="mt-0.5 text-ink-muted [&>svg]:size-4">{link.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{link.label}</span>
                <span className="block truncate text-xs text-ink-muted">{link.hint}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
