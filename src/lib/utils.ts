/**
 * Small, dependency-free utilities shared across server and client code.
 */

/** Join class names, skipping falsy values. */
export function cn(...classes: unknown[]): string {
  return classes.filter((c): c is string => typeof c === "string" && c.length > 0).join(" ");
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Generate a URL-safe id (works in both Node and the browser). */
export function uid(prefix = ""): string {
  let out = "";
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  } else {
    for (let i = 0; i < 16; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return prefix ? `${prefix}_${out}` : out;
}

/** Short uppercase code like "8F3K-2Q9Z" (used for certificates, orders). */
export function shortCode(groups = 2, size = 4): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(groups * size);
  globalThis.crypto.getRandomValues(bytes);
  const parts: string[] = [];
  for (let g = 0; g < groups; g++) {
    let part = "";
    for (let i = 0; i < size; i++) part += chars[bytes[g * size + i]! % chars.length];
    parts.push(part);
  }
  return parts.join("-");
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item"
  );
}

/** Ensure a slug is unique against an existing set by suffixing -2, -3, … */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const root = slugify(base);
  if (!set.has(root)) return root;
  let i = 2;
  while (set.has(`${root}-${i}`)) i++;
  return `${root}-${i}`;
}

/** 125 -> "2:05", 3725 -> "1:02:05" */
export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Parse "1:02:05" / "2:05" / "125" into seconds. Returns NaN if invalid. */
export function parseTime(input: string): number {
  const parts = input.trim().split(":").map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** 3725 -> "1h 2m", 125 -> "2m", 30 -> "30s" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Format an amount given in the smallest currency unit. */
export function formatPrice(cents: number, currency = "USD", freeLabel = "Free"): string {
  if (!cents) return freeLabel;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: n >= 10000 ? "compact" : "standard" }).format(n);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso: string | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", ...opts });
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "14:30" -> "2:30 PM" */
export function formatClock(hhmm: string | undefined): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.round((now.getTime() - then) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs) return rtf.format(-Math.round(diff / secs), unit);
  }
  return abs < 10 ? "just now" : rtf.format(-diff, "second");
}

/** Local YYYY-MM-DD for a date. */
export function toDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

export function truncate(text: string, max = 140): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

/** Strip markdown syntax for previews. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>]/g, "")
    .replace(/^\s*[-+*]\s+/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Rough reading time for markdown content, in seconds (200 wpm). */
export function readingTimeSeconds(md: string): number {
  const words = stripMarkdown(md).split(/\s+/).filter(Boolean).length;
  return Math.ceil((words / 200) * 60);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidUrl(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

/** Deterministic shuffle based on a string seed (so a quiz attempt is stable across reloads). */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export function groupBy<T, K extends string | number>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    (out[k] ||= []).push(item);
  }
  return out;
}

export function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/** Read a string field from FormData, trimmed. */
export function fd(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function fdBool(form: FormData, key: string): boolean {
  const v = form.get(key);
  return v === "on" || v === "true" || v === "1";
}

export function fdNumber(form: FormData, key: string, fallback = 0): number {
  const n = Number(fd(form, key));
  return Number.isFinite(n) ? n : fallback;
}

/** Split comma/newline separated text into a clean list. */
export function splitList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Split newline-separated text into a clean list (keeps commas). */
export function splitLines(text: string): string[] {
  return text
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Tailwind gradient classes for course cards without an image (mirrors Frappe's card_gradient). */
export const gradientClasses: Record<string, string> = {
  red: "from-rose-500 to-red-600",
  blue: "from-sky-500 to-blue-600",
  green: "from-emerald-500 to-green-600",
  amber: "from-amber-400 to-orange-500",
  cyan: "from-cyan-400 to-sky-600",
  orange: "from-orange-400 to-red-500",
  pink: "from-pink-400 to-fuchsia-600",
  purple: "from-purple-500 to-indigo-600",
  teal: "from-teal-400 to-emerald-600",
  violet: "from-violet-500 to-purple-700",
  yellow: "from-yellow-300 to-amber-500",
};

export function gradientFor(key: string | undefined): string {
  return gradientClasses[key ?? "blue"] ?? gradientClasses.blue!;
}
