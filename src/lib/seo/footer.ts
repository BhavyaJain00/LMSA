/**
 * Small pure helpers of the site footer: where the full footer is shown and
 * how official profile links are labelled.
 */

/** Sections made of public, indexable pages: they get the full footer with its internal links. */
const PUBLIC_SECTIONS = ["/courses", "/batches", "/programs", "/jobs", "/blog", "/instructors", "/user", "/legal", "/sitemap", "/free", "/pricing", "/certified-members"];

/**
 * Whether a page shows the full footer (categories, popular courses, articles…).
 * Working pages (dashboard, admin, settings, checkout, quizzes…) get the
 * one-line footer instead, so the navigation never competes with the task.
 */
export function hasFullFooter(pathname: string): boolean {
  if (pathname === "/" || pathname === "") return true;
  return PUBLIC_SECTIONS.some((section) => pathname === section || pathname.startsWith(`${section}/`));
}

const NETWORKS: [pattern: RegExp, label: string][] = [
  [/(^|\.)linkedin\.com$/, "LinkedIn"],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, "YouTube"],
  [/(^|\.)x\.com$|(^|\.)twitter\.com$/, "X"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)facebook\.com$/, "Facebook"],
  [/(^|\.)github\.com$/, "GitHub"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)threads\.(net|com)$/, "Threads"],
  [/(^|\.)bsky\.app$/, "Bluesky"],
  [/(^|\.)discord\.(gg|com)$/, "Discord"],
  [/(^|\.)t\.me$|(^|\.)telegram\.(me|org)$/, "Telegram"],
  [/(^|\.)whatsapp\.com$|(^|\.)wa\.me$/, "WhatsApp"],
  [/(^|\.)medium\.com$/, "Medium"],
  [/(^|\.)wikipedia\.org$/, "Wikipedia"],
];

/** Name of the network behind a profile URL ("LinkedIn", "YouTube"…), else its host name; null for unusable URLs. */
export function socialLabel(url: string): string | null {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  return NETWORKS.find(([pattern]) => pattern.test(host))?.[1] ?? host.replace(/^www\./, "");
}
