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

/** A link target that stays on this site: a root-relative path (not `//host`), a query or a fragment. */
function isSameOriginHref(href: string): boolean {
  return (/^\/(?!\/)/.test(href) && !href.includes("\\")) || href.startsWith("#") || href.startsWith("?");
}

/** A URL shown as inline code: readable and copyable, but neither a link nor an image. */
function asCode(url: string): string {
  const clean = url.replace(/`+/g, "");
  return clean ? `\`${clean}\`` : "";
}

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g;
const LINK_OR_URL_RE = /\[([^\]]+)\]\(([^)\s]*)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()[\]`]+[^\s<>()[\]`.,;:!?'"])/gi;
/** Split into prose (even indexes) and fenced or inline code (odd indexes). */
const CODE_SPLIT_RE = /((?:```|~~~)[\s\S]*?(?:```|~~~|$)|`[^`\n]*`)/g;

function rewriteProse(text: string): string {
  // Images first, so an image inside a link's text (`[![x](a)](b)`) is gone before links are read.
  return text
    .replace(IMAGE_RE, (_whole, alt: string) => alt.trim())
    .replace(LINK_OR_URL_RE, (whole, label: string | undefined, href: string | undefined, bare: string | undefined) => {
      if (label !== undefined) {
        const target = (href ?? "").trim();
        if (isSameOriginHref(target)) return whole;
        const code = asCode(target);
        return code && label.trim() !== target ? `${label} (${code})` : code || label;
      }
      return bare ? asCode(bare) : whole;
    });
}

/**
 * Make model output safe to render as markdown (pure; run before
 * `linkCitations`). Tutor answers are untrusted text: a prompt injection in
 * course material or the learner's question could make the model emit an
 * image whose URL carries the conversation to another server, which the
 * browser would fetch as soon as the answer renders (also on the staff
 * review screen), or a phishing link. So, outside code:
 *
 *  - images are never rendered: only their alt text is kept;
 *  - links that leave the site become their text followed by the URL as
 *    inline code (visible, not clickable); links within the site stay;
 *  - bare web addresses become inline code instead of autolinks.
 */
export function neutralizeAnswerMarkdown(content: string): string {
  const eachProse = (text: string, fn: (prose: string) => string) =>
    text
      .split(CODE_SPLIT_RE)
      .map((part, i) => (i % 2 === 1 ? part : fn(part)))
      .join("");
  let out = content;
  // Rewriting can join pieces into a new token (`![![a](b)](c)`), so repeat until nothing changes.
  for (let pass = 0; pass < 5; pass++) {
    const next = eachProse(out, rewriteProse);
    if (next === out) break;
    out = next;
  }
  // Whatever still starts an image after that is broken up so it can never load.
  return eachProse(out, (prose) => prose.replace(/!\[/g, "!\u200b["));
}
