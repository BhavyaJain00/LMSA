/**
 * Citation rendering helpers for AI tutor answers (client-safe, pure).
 *
 * Answers cite excerpts as [1], [2]…; the chat turns each valid marker
 * outside code into a small markdown link to the cited lesson.
 */

export interface CitationLink {
  n: number;
  href: string;
  title: string;
}

/** Markdown link titles are wrapped in double quotes and can't contain them. */
function linkTitle(text: string): string {
  return text.replace(/"+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Replace `[n]` markers (outside fenced and inline code) with
 * `[(n)](href "title")` links. Unknown numbers, index expressions such as
 * `items[1]` and existing links are left untouched.
 */
export function linkCitations(content: string, links: CitationLink[]): string {
  if (!links.length) return content;
  const byNumber = new Map(links.map((l) => [l.n, l]));
  const replace = (text: string) =>
    text.replace(/(?<!\w)\[(\d{1,2})\](?!\()/g, (whole, digits: string) => {
      const link = byNumber.get(Number(digits));
      if (!link || /[\s)]/.test(link.href)) return whole;
      return `[(${link.n})](${link.href} "${linkTitle(link.title)}")`;
    });
  // Split into code and non-code segments; only prose is rewritten.
  const parts = content.split(/((?:```|~~~)[\s\S]*?(?:```|~~~|$)|`[^`\n]*`)/g);
  return parts.map((part, i) => (i % 2 === 1 ? part : replace(part))).join("");
}

/**
 * `/courses/x/learn/1-2` + 135 → `/courses/x/learn/1-2?t=135`. With a video
 * block id, `&block=<id>` makes the link seek that video instead of the
 * lesson's first one.
 */
export function withTimestamp(href: string, seconds: number | undefined, blockId?: string): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return href;
  const [path, hash] = href.split("#");
  const sep = path!.includes("?") ? "&" : "?";
  const block = blockId ? `&block=${encodeURIComponent(blockId)}` : "";
  return `${path}${sep}t=${Math.floor(seconds)}${block}${hash ? `#${hash}` : ""}`;
}
