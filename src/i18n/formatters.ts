import { formatClock, formatDate, formatDateTime, formatNumber, formatPrice, relativeTime } from "@/lib/utils";
import { intlLocale, type Locale } from "./config";

/**
 * Locale-aware formatting through `Intl`, bound to the active language.
 * Server: `const f = await getFormatter()`; client: `const f = useFormatter()`.
 *
 *   f.date("2026-03-01")              "Mar 1, 2026" · "1 mars 2026" · "1 مارس 2026"
 *   f.dateTime(iso)                   date and time
 *   f.clock("14:30")                  "2:30 PM" · "14:30"
 *   f.number(12000)                   "12,000" · "12 000" · "12.000"
 *   f.price(1999, "EUR", freeLabel)   "€19.99" · "19,99 €"
 *   f.relative(iso)                   "3 days ago" · "il y a 3 jours" · "قبل 3 أيام"
 *   f.list(["a", "b", "c"])           "a, b, and c" · "a, b et c"
 *   f.duration(3725)                  "1h 2m" in the locale's unit style
 */
export interface Formatters {
  readonly locale: Locale;
  date(iso: string | undefined, options?: Intl.DateTimeFormatOptions): string;
  dateTime(iso: string | undefined): string;
  clock(hhmm: string | undefined): string;
  number(n: number, options?: Intl.NumberFormatOptions): string;
  /** Compact for large values ("12K"), like `formatNumber`. */
  count(n: number): string;
  percent(value: number, options?: { fraction?: boolean; maximumFractionDigits?: number }): string;
  price(cents: number, currency?: string, freeLabel?: string): string;
  relative(iso: string, now?: Date): string;
  list(items: string[], type?: "conjunction" | "disjunction"): string;
  duration(totalSeconds: number): string;
}

export function createFormatters(locale: Locale): Formatters {
  const tag = intlLocale(locale);
  return {
    locale,
    date: (iso, options) => formatDate(iso, options, locale),
    dateTime: (iso) => formatDateTime(iso, locale),
    clock: (hhmm) => formatClock(hhmm, locale),
    number: (n, options) => new Intl.NumberFormat(tag, options).format(n),
    count: (n) => formatNumber(n, locale),
    percent: (value, options = {}) =>
      new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: options.maximumFractionDigits ?? 0 }).format(options.fraction ? value : value / 100),
    price: (cents, currency, freeLabel) => formatPrice(cents, currency, freeLabel, locale),
    relative: (iso, now) => relativeTime(iso, now, locale),
    list: (items, type = "conjunction") => new Intl.ListFormat(tag, { style: "long", type }).format(items),
    duration: (totalSeconds) => formatLocalizedDuration(totalSeconds, locale),
  };
}

/** "1h 2m" / "2m" / "30s" in the locale's narrow unit style. */
export function formatLocalizedDuration(totalSeconds: number, locale: Locale): string {
  const s = Math.max(0, Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const tag = intlLocale(locale);
  const unit = (value: number, u: "hour" | "minute" | "second") => new Intl.NumberFormat(tag, { style: "unit", unit: u, unitDisplay: "narrow" }).format(value);
  if (h > 0) return m > 0 ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(h, "hour");
  if (m > 0) return unit(m, "minute");
  return unit(s, "second");
}
