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

/*
 * Inline parsing runs in linear time, whatever the input. Authors control
 * up to 20,000 characters of markdown and every search for a closing
 * delimiter used to rescan the rest of the text, so pathological input
 * (thousands of unmatched `*`, `_`, `[`, `![`, `~~`) cost seconds per render.
 * Each `parseInline` call now precomputes, lazily and in single passes:
 *  - which characters are backslash-escaped,
 *  - the matching `]` of every `[` (one stack pass),
 *  - for each emphasis delimiter, the next valid closer at or after every
 *    position (one backward pass),
 * so every lookup is O(1). Code-span searches remember failures per run
 * length, link destinations stop after 32 nested parentheses or 2,048
 * characters, titles after 1,000 characters, and nesting is capped, so the
 * total work stays proportional to the input length.
 */

const MAX_LINK_PAREN_DEPTH = 32;
const MAX_LINK_DEST = 2048;
const MAX_LINK_TITLE = 1000;
/** Emphasis may nest this deep; links and images less. */
const MAX_EMPHASIS_DEPTH = 8;
const MAX_LINK_DEPTH = 4;

interface InlineScan {
  src: string;
  escaped?: Uint8Array;
  brackets?: Int32Array;
  closers: Map<string, Int32Array>;
  /** Backtick run length → position from which no closing run of that length exists. */
  codeMiss: Map<number, number>;
}

/** Whitespace test with an ASCII fast path (it runs for most characters of the input). */
function isSpace(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  const code = ch.charCodeAt(0);
  if (code < 128) return code === 32 || (code >= 9 && code <= 13);
  return /\s/.test(ch);
}
const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** `escaped[i]` is 1 when character i follows an unescaped backslash (odd run of backslashes). */
function escapedFlags(scan: InlineScan): Uint8Array {
  if (scan.escaped) return scan.escaped;
  const { src } = scan;
  const out = new Uint8Array(src.length);
  for (let i = 1; i < src.length; i++) if (src.charCodeAt(i - 1) === 92 && !out[i - 1]) out[i] = 1;
  scan.escaped = out;
  return out;
}

/**
 * Matching `]` for every `[` (-1 when unmatched), skipping escaped brackets
 * and brackets inside backtick pairs. A blank line ends every open bracket.
 */
function bracketMatches(scan: InlineScan): Int32Array {
  if (scan.brackets) return scan.brackets;
  const { src } = scan;
  const esc = escapedFlags(scan);
  const match = new Int32Array(src.length).fill(-1);
  const stack: number[] = [];
  let noBacktickAfter = src.length;
  for (let i = 0; i < src.length; i++) {
    if (esc[i]) continue;
    const ch = src[i];
    if (ch === "`") {
      if (i >= noBacktickAfter) continue;
      const close = src.indexOf("`", i + 1);
      if (close === -1) noBacktickAfter = i;
      else i = close;
    } else if (ch === "[") {
      stack.push(i);
    } else if (ch === "]") {
      const open = stack.pop();
      if (open !== undefined) match[open] = i;
    } else if (ch === "\n" && src[i + 1] === "\n") {
      stack.length = 0;
    }
  }
  scan.brackets = match;
  return match;
}

/**
 * For delimiter `delim` ("*", "**", "_", "__", "~~" or "=="): `table[k]` is
 * the first position ≥ k where a closing delimiter may stand, or -1. A closer
 * is unescaped and follows a non-space character; a single `*`/`_` must not
 * touch another one, and `_` must not be followed by a letter or digit.
 */
function closerTable(scan: InlineScan, delim: string): Int32Array {
  const cached = scan.closers.get(delim);
  if (cached) return cached;
  const { src } = scan;
  const esc = escapedFlags(scan);
  const n = src.length;
  const c = delim[0]!;
  const double = delim.length === 2;
  const table = new Int32Array(n + 1);
  table[n] = -1;
  for (let j = n - 1; j >= 0; j--) {
    let ok = src[j] === c && !esc[j] && j > 0 && !isSpace(src[j - 1]);
    if (ok) {
      if (double) ok = src[j + 1] === c;
      else ok = (src[j - 1] !== c || esc[j - 1] === 1) && src[j + 1] !== c && !(c === "_" && isWordChar(src[j + 1]));
    }
    table[j] = ok ? j : table[j + 1]!;
  }
  scan.closers.set(delim, table);
  return table;
}

/** The closing delimiter for a span whose content starts at `from` (never at `from` itself). */
function findClosing(scan: InlineScan, from: number, delim: string): number {
  const table = closerTable(scan, delim);
  const k = from + 1;
  return k < table.length ? table[k]! : -1;
}

/** Start of the next run of exactly `run` backticks at or after `from`, or -1. */
function findCodeClose(scan: InlineScan, from: number, run: number): number {
  const miss = scan.codeMiss.get(run);
  if (miss !== undefined && from >= miss) return -1;
  const { src } = scan;
  let j = from;
  for (;;) {
    const k = src.indexOf("`", j);
    if (k === -1) break;
    let end = k;
    while (src.charCodeAt(end) === 96) end++;
    if (end - k === run) return k;
    j = end;
  }
  // No closer after `from` means none after any later position either.
  scan.codeMiss.set(run, from);
  return -1;
}

/** Parse `[label](dest "title")` starting at `start` (which must be "["). */
function parseLinkParts(scan: InlineScan, start: number): LinkParts | null {
  const { src } = scan;
  const labelEnd = bracketMatches(scan)[start] ?? -1;
  if (labelEnd < 0 || src[labelEnd + 1] !== "(") return null;
  let j = labelEnd + 2;
  while (src[j] === " ") j++;
  let dest: string;
  if (src[j] === "<") {
    // <dest>: no line breaks or other angle brackets inside.
    let k = j + 1;
    while (k < src.length && src[k] !== ">" && src[k] !== "<" && src[k] !== "\n") k++;
    if (src[k] !== ">") return null;
    dest = src.slice(j + 1, k);
    j = k + 1;
  } else {
    let parens = 0;
    const startDest = j;
    for (; j < src.length; j++) {
      if (j - startDest > MAX_LINK_DEST) return null;
      const ch = src[j]!;
      if (ch === "\\" && j + 1 < src.length) {
        j++;
        continue;
      }
      if (isSpace(ch)) break;
      if (ch === "(") {
        if (++parens > MAX_LINK_PAREN_DEPTH) return null;
      } else if (ch === ")") {
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
    const limit = Math.min(src.length, j + 1 + MAX_LINK_TITLE);
    let close = j + 1;
    while (close < limit && src[close] !== quote) close += src[close] === "\\" ? 2 : 1;
    if (close >= limit || src[close] !== quote) return null;
    title = src.slice(j + 1, close).replace(/\\(.)/g, "$1");
    j = close + 1;
    while (src[j] === " ") j++;
  }
  if (src[j] !== ")") return null;
  return { label: src.slice(start + 1, labelEnd), dest: dest.replace(/\\(.)/g, "$1"), title, end: j + 1 };
}

/** Sticky: matched at an explicit position, no substring copies. */
const AUTOLINK_RE = /https?:\/\/[^\s<>"\\]+[^\s<>".,;:!?)\]'*_~\\]/iy;

/** Remove trailing spaces and tabs (manual loop: `/[ \t]+$/` backtracks quadratically on long space runs). */
function trimTrailingBlanks(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === " " || text[end - 1] === "\t")) end--;
  return end === text.length ? text : text.slice(0, end);
}

function parseInline(src: string, depth = 0): InlineNode[] {
  const scan: InlineScan = { src, closers: new Map(), codeMiss: new Map() };
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
      text = trimTrailingBlanks(text);
      flush();
      nodes.push({ type: "br" });
      i++;
      while (src[i] === " " || src[i] === "\t") i++;
      continue;
    }

    if (ch === "`") {
      let run = 1;
      while (src[i + run] === "`") run++;
      const close = findCodeClose(scan, i + run, run);
      if (close !== -1) {
        flush();
        let value = src.slice(i + run, close).replace(/\n/g, " ");
        if (value.length >= 2 && value[0] === " " && value[value.length - 1] === " " && value.trim()) value = value.slice(1, -1);
        nodes.push({ type: "code", value });
        i = close + run;
        continue;
      }
      text += src.slice(i, i + run);
      i += run;
      continue;
    }

    if (ch === "!" && next === "[" && depth < MAX_LINK_DEPTH) {
      const parts = parseLinkParts(scan, i + 1);
      if (parts) {
        flush();
        nodes.push({ type: "image", src: parts.dest, alt: plainText(parseInline(parts.label, depth + 1)), title: parts.title });
        i = parts.end;
        continue;
      }
    }

    if (ch === "[" && depth < MAX_LINK_DEPTH) {
      const parts = parseLinkParts(scan, i);
      if (parts) {
        flush();
        nodes.push({ type: "link", href: parts.dest, title: parts.title, children: parseInline(parts.label, depth + 1) });
        i = parts.end;
        continue;
      }
    }

    if ((ch === "*" || ch === "_") && depth < MAX_EMPHASIS_DEPTH) {
      const double = next === ch;
      const len = double ? 2 : 1;
      const delim = ch.repeat(len);
      const opensOk = !isSpace(src[i + len]) && !(ch === "_" && isWordChar(src[i - 1]));
      if (opensOk) {
        const close = findClosing(scan, i + len, delim);
        if (close !== -1) {
          flush();
          nodes.push({ type: double ? "strong" : "em", children: parseInline(src.slice(i + len, close), depth + 1) });
          i = close + len;
          continue;
        }
      }
    }

    if ((ch === "~" || ch === "=") && next === ch && !isSpace(src[i + 2]) && depth < MAX_EMPHASIS_DEPTH) {
      const delim = ch + ch;
      const close = findClosing(scan, i + 2, delim);
      if (close !== -1) {
        flush();
        nodes.push({ type: ch === "~" ? "del" : "mark", children: parseInline(src.slice(i + 2, close), depth + 1) });
        i = close + 2;
        continue;
      }
    }

    if ((ch === "h" || ch === "H") && (i === 0 || /[\s(]/.test(src[i - 1]!))) {
      AUTOLINK_RE.lastIndex = i;
      const m = AUTOLINK_RE.exec(src);
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
/*
 * Block syntax is recognised with small helpers instead of one regex each:
 * patterns such as `\s*([\w]*)\s*$` or `(.*?)\s*#*\s*$` backtrack
 * quadratically on long runs of spaces, which an author could exploit.
 */

/** Opening code fence: up to 3 spaces, 3+ backticks or tildes, optional one-word language. */
function fenceOf(line: string): { marker: string; lang: string } | null {
  const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  const lang = m[2]!.trim();
  return /^[\w+#.-]*$/.test(lang) ? { marker: m[1]!, lang } : null;
}

/** ATX heading; a closing run of "#" is removed only when a space precedes it ("# C#" keeps its "#"). */
function headingOf(line: string): { level: number; text: string } | null {
  const m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
  if (!m) return null;
  let text = m[2]!.trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  if (end < text.length && (end === 0 || /\s/.test(text[end - 1]!))) text = text.slice(0, end).trimEnd();
  return { level: m[1]!.length, text };
}

/** Thematic break: 3+ of the same "-", "*" or "_", optionally spaced, indented at most 3. */
function isRule(line: string): boolean {
  if (line.length - line.trimStart().length > 3) return false;
  const compact = line.replace(/\s+/g, "");
  if (compact.length < 3) return false;
  const c = compact[0];
  if (c !== "-" && c !== "*" && c !== "_") return false;
  for (let k = 1; k < compact.length; k++) if (compact[k] !== c) return false;
  return true;
}

/** Table delimiter row, e.g. "| :--- | ---: |". */
function isTableSeparator(line: string): boolean {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  if (!s) return false;
  return s.split("|").every((cell) => /^\s*:?-{2,}:?\s*$/.test(cell));
}

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
  return !line.trim() || !!headingOf(line) || !!fenceOf(line) || /^\s*>/.test(line) || LIST_RE.test(line) || isRule(line);
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

    const fence = fenceOf(line);
    if (fence) {
      const marker = fence.marker;
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(marker[0]!.repeat(marker.length))) {
        code.push(lines[i]!);
        i++;
      }
      i++;
      blocks.push({ type: "code", lang: fence.lang, code: code.join("\n") });
      continue;
    }

    const heading = headingOf(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading.level, text: heading.text });
      i++;
      continue;
    }

    if (isRule(line)) {
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

    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
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
    while (i < lines.length && !startsBlock(lines[i]!) && !(lines[i]!.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!))) {
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
