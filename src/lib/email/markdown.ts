/**
 * Markdown → email-safe HTML (and plain text), as strings.
 *
 * Email clients need inline styles and cannot run React, so announcements and
 * batch messages are rendered with this small renderer instead of
 * `src/lib/markdown.tsx`. It supports the same syntax: headings, paragraphs
 * (single newlines become line breaks), bold, italic, strike, ==highlight==,
 * inline code, links, images, autolinks, ordered/unordered/task lists
 * (nested), block quotes, fenced code, horizontal rules and tables, plus
 * backslash escapes.
 *
 * Safety: raw HTML is never passed through — every character of user text is
 * escaped. Links are limited to http(s)/mailto and app-relative paths (made
 * absolute); `javascript:`, `data:`, `vbscript:` and every other scheme are
 * dropped (the link text is kept). Images must be http(s) or app-relative.
 *
 * Pure module (no Node or app imports).
 */
import { escapeHtml, safeImageUrl, safeLinkUrl } from "./html";

export interface EmailMarkdownOptions {
  /** Absolute app URL used to resolve "/relative" links and images. */
  baseUrl: string;
  /** Link color (hex). */
  accentColor?: string;
}

/* ------------------------------------------------------------------ */
/* Inline AST                                                          */
/* ------------------------------------------------------------------ */

type InlineNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "br" }
  | { type: "strong" | "em" | "del" | "mark"; children: InlineNode[] }
  | { type: "link"; href: string; title?: string; children: InlineNode[]; auto?: boolean }
  | { type: "image"; src: string; alt: string; title?: string };

/** Characters that can be backslash-escaped. */
const ESCAPABLE = "\\`*_{}[]()#+-.!|~=<>\"':";

/** Escape markdown syntax in a value (e.g. a member name) before inserting it into markdown. */
export function escapeMarkdown(value: string): string {
  let out = "";
  for (const ch of value.replace(/[\r\n]+/g, " ")) out += ESCAPABLE.includes(ch) ? `\\${ch}` : ch;
  return out;
}

interface LinkParts {
  label: string;
  dest: string;
  title?: string;
  end: number;
}

/** Parse `[label](dest "title")` starting at `start` (which must be "["). */
function parseLinkParts(src: string, start: number): LinkParts | null {
  let depth = 0;
  let i = start;
  let labelEnd = -1;
  for (; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "`") {
      const close = src.indexOf("`", i + 1);
      if (close !== -1) i = close;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        labelEnd = i;
        break;
      }
    } else if (ch === "\n" && src[i + 1] === "\n") return null;
  }
  if (labelEnd === -1 || src[labelEnd + 1] !== "(") return null;
  let j = labelEnd + 2;
  while (src[j] === " ") j++;
  let dest = "";
  if (src[j] === "<") {
    const close = src.indexOf(">", j + 1);
    if (close === -1) return null;
    dest = src.slice(j + 1, close);
    j = close + 1;
  } else {
    let parens = 0;
    const startDest = j;
    for (; j < src.length; j++) {
      const ch = src[j]!;
      if (ch === "\\" && j + 1 < src.length) {
        j++;
        continue;
      }
      if (/\s/.test(ch)) break;
      if (ch === "(") parens++;
      else if (ch === ")") {
        if (parens === 0) break;
        parens--;
      }
    }
    dest = src.slice(startDest, j);
  }
  while (src[j] === " ") j++;
  let title: string | undefined;
  const quote = src[j];
  if (quote === '"' || quote === "'") {
    let close = j + 1;
    while (close < src.length && src[close] !== quote) close += src[close] === "\\" ? 2 : 1;
    if (close >= src.length) return null;
    title = src.slice(j + 1, close).replace(/\\(.)/g, "$1");
    j = close + 1;
    while (src[j] === " ") j++;
  }
  if (src[j] !== ")") return null;
  return { label: src.slice(start + 1, labelEnd), dest: dest.replace(/\\(.)/g, "$1"), title, end: j + 1 };
}

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Find the closing delimiter for emphasis-like spans. */
function findClosing(src: string, from: number, delim: string): number {
  let j = from;
  while (j < src.length) {
    j = src.indexOf(delim, j);
    if (j === -1) return -1;
    let backslashes = 0;
    for (let k = j - 1; k >= 0 && src[k] === "\\"; k--) backslashes++;
    if (backslashes % 2 === 1 || j === from || isSpace(src[j - 1])) {
      j += 1;
      continue;
    }
    if (delim.length === 1 && src[j + 1] === delim) {
      j += 2;
      continue;
    }
    if (delim === "_" && isWordChar(src[j + 1])) {
      j += 1;
      continue;
    }
    return j;
  }
  return -1;
}

const AUTOLINK_RE = /^https?:\/\/[^\s<>"\\]+[^\s<>".,;:!?)\]'*_~\\]/i;

function parseInline(src: string, depth = 0): InlineNode[] {
  const nodes: InlineNode[] = [];
  let text = "";
  const flush = () => {
    if (text) {
      nodes.push({ type: "text", value: text });
      text = "";
    }
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];

    if (ch === "\\") {
      if (next === "\n") {
        flush();
        nodes.push({ type: "br" });
        i += 2;
        continue;
      }
      if (next !== undefined && ESCAPABLE.includes(next)) {
        text += next;
        i += 2;
        continue;
      }
    }

    if (ch === "\n") {
      text = text.replace(/[ \t]+$/, "");
      flush();
      nodes.push({ type: "br" });
      i++;
      while (src[i] === " " || src[i] === "\t") i++;
      continue;
    }

    if (ch === "`") {
      let run = 1;
      while (src[i + run] === "`") run++;
      const fence = "`".repeat(run);
      let close = src.indexOf(fence, i + run);
      while (close !== -1 && src[close + run] === "`") close = src.indexOf(fence, close + run + 1);
      if (close !== -1) {
        flush();
        let value = src.slice(i + run, close).replace(/\n/g, " ");
        if (/^ .* $/.test(value) && value.trim()) value = value.slice(1, -1);
        nodes.push({ type: "code", value });
        i = close + run;
        continue;
      }
      text += fence;
      i += run;
      continue;
    }

    if (ch === "!" && next === "[") {
      const parts = parseLinkParts(src, i + 1);
      if (parts) {
        flush();
        nodes.push({ type: "image", src: parts.dest, alt: plainText(parseInline(parts.label, depth + 1)), title: parts.title });
        i = parts.end;
        continue;
      }
    }

    if (ch === "[" && depth < 4) {
      const parts = parseLinkParts(src, i);
      if (parts) {
        flush();
        nodes.push({ type: "link", href: parts.dest, title: parts.title, children: parseInline(parts.label, depth + 1) });
        i = parts.end;
        continue;
      }
    }

    if ((ch === "*" || ch === "_") && depth < 8) {
      const double = next === ch;
      const len = double ? 2 : 1;
      const delim = ch.repeat(len);
      const opensOk = !isSpace(src[i + len]) && !(ch === "_" && isWordChar(src[i - 1]));
      if (opensOk) {
        const close = findClosing(src, i + len, delim);
        if (close !== -1) {
          flush();
          nodes.push({ type: double ? "strong" : "em", children: parseInline(src.slice(i + len, close), depth + 1) });
          i = close + len;
          continue;
        }
      }
    }

    if ((ch === "~" || ch === "=") && next === ch && !isSpace(src[i + 2]) && depth < 8) {
      const delim = ch + ch;
      const close = findClosing(src, i + 2, delim);
      if (close !== -1) {
        flush();
        nodes.push({ type: ch === "~" ? "del" : "mark", children: parseInline(src.slice(i + 2, close), depth + 1) });
        i = close + 2;
        continue;
      }
    }

    if ((ch === "h" || ch === "H") && (i === 0 || /[\s(]/.test(src[i - 1]!))) {
      const m = AUTOLINK_RE.exec(src.slice(i));
      if (m) {
        flush();
        nodes.push({ type: "link", href: m[0], auto: true, children: [{ type: "text", value: m[0] }] });
        i += m[0].length;
        continue;
      }
    }

    text += ch;
    i++;
  }
  flush();
  return nodes;
}

function plainText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.value;
        case "br":
          return " ";
        case "image":
          return n.alt;
        default:
          return plainText(n.children);
      }
    })
    .join("");
}

/* ------------------------------------------------------------------ */
/* Block AST                                                           */
/* ------------------------------------------------------------------ */

type Align = "left" | "center" | "right" | null;

interface ListItem {
  text: string;
  checked: boolean | null;
  children: Block[];
}

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "table"; header: string[]; rows: string[][]; align: Align[] };

const LIST_RE = /^(\s*)([-+*]|\d{1,9}[.)])\s+(.*)$/;
const FENCE_RE = /^\s{0,3}(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|") && !l.endsWith("\\|")) l = l.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < l.length; i++) {
    const ch = l[i]!;
    if (ch === "\\" && l[i + 1] === "|") {
      current += "\\|";
      i++;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function startsBlock(line: string): boolean {
  return !line.trim() || HEADING_RE.test(line) || FENCE_RE.test(line) || /^\s*>/.test(line) || LIST_RE.test(line) || HR_RE.test(line);
}

function parseBlocks(lines: string[], depth = 0): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(marker[0]!.repeat(marker.length))) {
        code.push(lines[i]!);
        i++;
      }
      i++;
      blocks.push({ type: "code", lang: fence[2] ?? "", code: code.join("\n") });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]! });
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && (/^\s*>/.test(lines[i]!) || (lines[i]!.trim() && !startsBlock(lines[i]!) && quote.length))) {
        quote.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", blocks: depth < 6 ? parseBlocks(quote, depth + 1) : [{ type: "paragraph", text: quote.join("\n") }] });
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]!)) {
      const header = splitRow(line);
      const align: Align[] = splitRow(lines[i + 1]!).map((c) => {
        const l = c.startsWith(":");
        const r = c.endsWith(":");
        return l && r ? "center" : r ? "right" : l ? "left" : null;
      });
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) {
        const row = splitRow(lines[i]!);
        while (row.length < header.length) row.push("");
        rows.push(row.slice(0, header.length));
        i++;
      }
      blocks.push({ type: "table", header, rows, align });
      continue;
    }

    const listMatch = LIST_RE.exec(line);
    if (listMatch) {
      const baseIndent = listMatch[1]!.length;
      const ordered = /\d/.test(listMatch[2]!);
      const start = ordered ? parseInt(listMatch[2]!, 10) : 1;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const m = LIST_RE.exec(current);
        if (m && m[1]!.length === baseIndent && /\d/.test(m[2]!) === ordered) {
          let text = m[3]!;
          let checked: boolean | null = null;
          const task = /^\[( |x|X)\]\s+(.*)$/.exec(text);
          if (task) {
            checked = task[1] !== " ";
            text = task[2]!;
          }
          items.push({ text, checked, children: [] });
          i++;
          continue;
        }
        if (!items.length) break;
        const indent = current.length - current.trimStart().length;
        if (current.trim() && indent > baseIndent) {
          // Nested content (sub-list or continuation) belongs to the last item.
          const nested: string[] = [];
          while (i < lines.length) {
            const l = lines[i]!;
            const ind = l.length - l.trimStart().length;
            if (l.trim() && ind > baseIndent) {
              nested.push(l.slice(Math.min(ind, baseIndent + 2)));
              i++;
            } else if (!l.trim() && i + 1 < lines.length && (lines[i + 1]!.length - lines[i + 1]!.trimStart().length) > baseIndent && lines[i + 1]!.trim()) {
              nested.push("");
              i++;
            } else break;
          }
          const last = items[items.length - 1]!;
          const nestedIsList = nested.some((l) => LIST_RE.test(l));
          if (nestedIsList && depth < 6) last.children.push(...parseBlocks(nested, depth + 1));
          else last.text += `\n${nested.join("\n").trim()}`;
          continue;
        }
        if (current.trim() && !startsBlock(current) && items.length) {
          // Lazy continuation line.
          items[items.length - 1]!.text += `\n${current.trim()}`;
          i++;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", ordered, start, items });
      continue;
    }

    const para: string[] = [line];
    i++;
    while (i < lines.length && !startsBlock(lines[i]!) && !(lines[i]!.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]!))) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push({ type: "paragraph", text: para.map((l) => l.trim()).join("\n") });
  }
  return blocks;
}

function parse(markdown: string): Block[] {
  return parseBlocks(markdown.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
}

/* ------------------------------------------------------------------ */
/* HTML rendering                                                      */
/* ------------------------------------------------------------------ */

const FONT_MONO = "SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const HEADING_SIZES = [0, 22, 19, 17, 16, 15, 14];

function renderInlineHtml(nodes: InlineNode[], opts: EmailMarkdownOptions): string {
  const accent = opts.accentColor ?? "#4f46e5";
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return escapeHtml(n.value);
        case "br":
          return "<br>";
        case "code":
          return `<code style="font-family:${FONT_MONO};font-size:0.9em;background:#f4f4f5;border-radius:4px;padding:1px 5px;color:#18181b;">${escapeHtml(n.value)}</code>`;
        case "strong":
          return `<strong style="font-weight:600;">${renderInlineHtml(n.children, opts)}</strong>`;
        case "em":
          return `<em>${renderInlineHtml(n.children, opts)}</em>`;
        case "del":
          return `<del>${renderInlineHtml(n.children, opts)}</del>`;
        case "mark":
          return `<mark style="background:#fef08a;color:inherit;padding:0 2px;border-radius:2px;">${renderInlineHtml(n.children, opts)}</mark>`;
        case "link": {
          const href = safeLinkUrl(n.href, opts.baseUrl);
          const inner = renderInlineHtml(n.children, opts);
          if (!href) return inner;
          const title = n.title ? ` title="${escapeHtml(n.title)}"` : "";
          return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer" style="color:${accent};text-decoration:underline;word-break:break-word;">${inner}</a>`;
        }
        case "image": {
          const src = safeImageUrl(n.src, opts.baseUrl);
          if (!src) return escapeHtml(n.alt);
          const title = n.title ? ` title="${escapeHtml(n.title)}"` : "";
          return `<img src="${escapeHtml(src)}" alt="${escapeHtml(n.alt)}"${title} style="display:block;max-width:100%;height:auto;border:0;border-radius:6px;margin:8px 0;">`;
        }
      }
    })
    .join("");
}

function renderBlocksHtml(blocks: Block[], opts: EmailMarkdownOptions): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading": {
          const level = Math.min(6, Math.max(1, block.level));
          return `<h${level} style="margin:24px 0 10px;font-size:${HEADING_SIZES[level]}px;line-height:1.3;font-weight:600;color:#18181b;">${renderInlineHtml(parseInline(block.text), opts)}</h${level}>`;
        }
        case "paragraph":
          return `<p style="margin:0 0 16px;line-height:1.6;">${renderInlineHtml(parseInline(block.text), opts)}</p>`;
        case "code":
          return `<pre style="margin:0 0 16px;padding:12px 14px;background:#f4f4f5;border-radius:8px;font-family:${FONT_MONO};font-size:13px;line-height:1.5;color:#18181b;white-space:pre-wrap;word-break:break-word;"><code>${escapeHtml(block.code)}</code></pre>`;
        case "quote":
          return `<blockquote style="margin:0 0 16px;padding:2px 0 2px 14px;border-left:3px solid #d4d4d8;color:#52525b;">${renderBlocksHtml(block.blocks, opts)}</blockquote>`;
        case "hr":
          return `<hr style="border:0;border-top:1px solid #e4e4e7;margin:24px 0;">`;
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          const isTask = block.items.some((it) => it.checked !== null);
          const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
          const style = isTask ? "margin:0 0 16px;padding-left:4px;list-style:none;" : "margin:0 0 16px;padding-left:24px;";
          const items = block.items
            .map((item) => {
              const box = item.checked === null ? "" : `<span style="font-family:${FONT_MONO};">${item.checked ? "&#9745;" : "&#9744;"}</span> `;
              const children = item.children.length ? renderBlocksHtml(item.children, opts).replace(/margin:0 0 16px;/g, "margin:6px 0 0;") : "";
              return `<li style="margin:0 0 6px;line-height:1.6;">${box}${renderInlineHtml(parseInline(item.text), opts)}${children}</li>`;
            })
            .join("");
          return `<${tag}${start} style="${style}">${items}</${tag}>`;
        }
        case "table": {
          const cell = (tagName: "th" | "td", content: string, align: Align) =>
            `<${tagName} style="border:1px solid #e4e4e7;padding:6px 10px;text-align:${align ?? "left"};${tagName === "th" ? "background:#f4f4f5;font-weight:600;" : ""}">${renderInlineHtml(parseInline(content), opts)}</${tagName}>`;
          const head = `<tr>${block.header.map((h, j) => cell("th", h, block.align[j] ?? null)).join("")}</tr>`;
          const body = block.rows.map((row) => `<tr>${row.map((c, j) => cell("td", c, block.align[j] ?? null)).join("")}</tr>`).join("");
          return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px;font-size:14px;width:100%;">${head}${body}</table>`;
        }
      }
    })
    .join("\n");
}

/** Render markdown to email-safe HTML with inline styles. */
export function markdownToEmailHtml(markdown: string, opts: EmailMarkdownOptions): string {
  if (!markdown?.trim()) return "";
  return renderBlocksHtml(parse(markdown), opts);
}

/* ------------------------------------------------------------------ */
/* Text rendering                                                      */
/* ------------------------------------------------------------------ */

function renderInlineText(nodes: InlineNode[], baseUrl: string): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.value;
        case "br":
          return "\n";
        case "strong":
        case "em":
        case "del":
        case "mark":
          return renderInlineText(n.children, baseUrl);
        case "link": {
          const label = renderInlineText(n.children, baseUrl);
          const href = safeLinkUrl(n.href, baseUrl);
          if (!href) return label;
          const bare = href.replace(/^mailto:/i, "");
          return n.auto || label === href || label === bare || label === n.href ? bare : `${label} (${bare})`;
        }
        case "image": {
          const src = safeImageUrl(n.src, baseUrl);
          return src ? `[${n.alt || "Image"}: ${src}]` : n.alt;
        }
      }
    })
    .join("");
}

function indentLines(text: string, prefix: string, firstPrefix = prefix): string {
  return text
    .split("\n")
    .map((l, i) => (i === 0 ? firstPrefix : prefix) + l)
    .join("\n");
}

function renderBlocksText(blocks: Block[], baseUrl: string): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading": {
          const text = renderInlineText(parseInline(block.text), baseUrl);
          return block.level <= 2 ? `${text}\n${(block.level === 1 ? "=" : "-").repeat(Math.min(60, Math.max(3, text.length)))}` : text;
        }
        case "paragraph":
          return renderInlineText(parseInline(block.text), baseUrl);
        case "code":
          return indentLines(block.code, "    ");
        case "quote":
          return indentLines(renderBlocksText(block.blocks, baseUrl), "> ");
        case "hr":
          return "----------";
        case "list":
          return block.items
            .map((item, idx) => {
              const marker = block.ordered ? `${block.start + idx}. ` : "- ";
              const box = item.checked === null ? "" : item.checked ? "[x] " : "[ ] ";
              const body = indentLines(`${box}${renderInlineText(parseInline(item.text), baseUrl)}`, " ".repeat(marker.length), marker);
              const children = item.children.length ? `\n${indentLines(renderBlocksText(item.children, baseUrl), "   ")}` : "";
              return body + children;
            })
            .join("\n");
        case "table": {
          const row = (cells: string[]) => cells.map((c) => renderInlineText(parseInline(c), baseUrl).replace(/\n/g, " ")).join(" | ");
          return [row(block.header), ...block.rows.map(row)].join("\n");
        }
      }
    })
    .join("\n\n");
}

/** Render markdown to readable plain text (for the text/plain alternative). */
export function markdownToText(markdown: string, opts: { baseUrl: string }): string {
  if (!markdown?.trim()) return "";
  return renderBlocksText(parse(markdown), opts.baseUrl).trim();
}
