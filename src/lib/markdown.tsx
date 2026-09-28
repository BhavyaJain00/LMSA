import type { ReactNode } from "react";
import { Fragment } from "react";

/**
 * A small, dependency-free Markdown renderer that outputs React elements.
 *
 * Supported: headings, paragraphs, hard line breaks, bold, italic, strike,
 * inline code, links, images, ordered/unordered/task lists (nested), block
 * quotes, fenced code blocks, horizontal rules, tables and ==highlights==.
 * Raw HTML is escaped (never rendered), which keeps user content safe.
 */

/* ----------------------------- Inline parsing ----------------------------- */

const INLINE_RE =
  /(`[^`]+`)|(!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\))|(\[[^\]]+\]\([^)\s]+(?:\s+"[^"]*")?\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~]+~~)|(==[^=]+==)|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/;

function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let i = 0;
  while (rest.length) {
    const match = INLINE_RE.exec(rest);
    if (!match || match.index === undefined) {
      nodes.push(...withBreaks(rest, `${keyPrefix}-${i++}`));
      break;
    }
    if (match.index > 0) nodes.push(...withBreaks(rest.slice(0, match.index), `${keyPrefix}-${i++}`));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (match[1]) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (match[2]) {
      const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/.exec(token);
      if (m) {
        // eslint-disable-next-line @next/next/no-img-element
        nodes.push(<img key={key} src={safeUrl(m[2]!)} alt={m[1] ?? ""} title={m[3]} loading="lazy" />);
      }
    } else if (match[3]) {
      const m = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/.exec(token);
      if (m) {
        const href = safeUrl(m[2]!);
        const external = /^https?:\/\//.test(href);
        nodes.push(
          <a key={key} href={href} title={m[3]} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
            {renderInline(m[1]!, `${key}-l`)}
          </a>,
        );
      }
    } else if (match[4] || match[5]) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2), `${key}-b`)}</strong>);
    } else if (match[6] || match[7]) {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), `${key}-e`)}</em>);
    } else if (match[8]) {
      nodes.push(<s key={key}>{renderInline(token.slice(2, -2), `${key}-s`)}</s>);
    } else if (match[9]) {
      nodes.push(<mark key={key}>{renderInline(token.slice(2, -2), `${key}-m`)}</mark>);
    } else if (match[10]) {
      nodes.push(
        <a key={key} href={safeUrl(token)} target="_blank" rel="noopener noreferrer">
          {token}
        </a>,
      );
    }
    rest = rest.slice(match.index + token.length);
  }
  return nodes;
}

function withBreaks(text: string, key: string): ReactNode[] {
  const parts = text.split(/ {2,}\n|\\\n/);
  if (parts.length === 1) return [<Fragment key={key}>{text}</Fragment>];
  return parts.flatMap((p, idx) =>
    idx === 0 ? [<Fragment key={`${key}-${idx}`}>{p}</Fragment>] : [<br key={`${key}-br-${idx}`} />, <Fragment key={`${key}-${idx}`}>{p}</Fragment>],
  );
}

function safeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return "#";
  return trimmed;
}

/* ------------------------------ Block parsing ------------------------------ */

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "quote"; lines: string[] }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "table"; header: string[]; rows: string[][]; align: ("left" | "center" | "right" | null)[] };

interface ListItem {
  text: string;
  checked: boolean | null;
  children: Block[];
}

const LIST_RE = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/;

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    // Fenced code
    const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const lang = fence[2] ?? "";
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(marker)) {
        code.push(lines[i]!);
        i++;
      }
      i++;
      blocks.push({ type: "code", lang, code: code.join("\n") });
      continue;
    }
    // Heading
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]! });
      i++;
      continue;
    }
    // Horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    // Block quote
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", lines: quote });
      continue;
    }
    // Table
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]!)) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]!).map((c) => {
        const l = c.startsWith(":");
        const r = c.endsWith(":");
        return l && r ? "center" : r ? "right" : l ? "left" : null;
      });
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      blocks.push({ type: "table", header, rows, align });
      continue;
    }
    // List
    const listMatch = LIST_RE.exec(line);
    if (listMatch) {
      const baseIndent = listMatch[1]!.length;
      const ordered = /\d/.test(listMatch[2]!);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]!);
        if (!m || m[1]!.length !== baseIndent || /\d/.test(m[2]!) !== ordered) {
          if (!m && lines[i]!.trim() && lines[i]!.startsWith(" ".repeat(baseIndent + 2)) && items.length) {
            // continuation line
            items[items.length - 1]!.text += " " + lines[i]!.trim();
            i++;
            continue;
          }
          if (m && m[1]!.length > baseIndent && items.length) {
            // nested list
            const nested: string[] = [];
            while (i < lines.length) {
              const nm = LIST_RE.exec(lines[i]!);
              if (nm && nm[1]!.length > baseIndent) {
                nested.push(lines[i]!.slice(baseIndent + 2));
                i++;
              } else if (!nm && lines[i]!.trim() && lines[i]!.startsWith(" ".repeat(baseIndent + 2))) {
                nested.push(lines[i]!.slice(baseIndent + 2));
                i++;
              } else break;
            }
            items[items.length - 1]!.children.push(...parseBlocks(nested));
            continue;
          }
          break;
        }
        let text = m[3]!;
        let checked: boolean | null = null;
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(text);
        if (task) {
          checked = task[1] !== " ";
          text = task[2]!;
        }
        items.push({ text, checked, children: [] });
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    // Paragraph: collect until blank line or block start
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const l = lines[i]!;
      if (!l.trim() || /^(#{1,6})\s/.test(l) || /^\s*(```|~~~)/.test(l) || /^\s*>/.test(l) || LIST_RE.test(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) break;
      para.push(l);
      i++;
    }
    blocks.push({ type: "paragraph", text: para.join("\n") });
  }
  return blocks;
}

function splitRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split("|").map((c) => c.trim());
}

/* -------------------------------- Rendering -------------------------------- */

function renderBlocks(blocks: Block[], keyPrefix = "b"): ReactNode[] {
  return blocks.map((block, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (block.type) {
      case "heading": {
        const Tag = `h${Math.min(6, block.level)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        return (
          <Tag key={key} id={slugHeading(block.text)}>
            {renderInline(block.text, key)}
          </Tag>
        );
      }
      case "paragraph":
        return <p key={key}>{renderInline(block.text, key)}</p>;
      case "code":
        return (
          <pre key={key} data-lang={block.lang || undefined}>
            <code>{block.code}</code>
          </pre>
        );
      case "quote":
        return <blockquote key={key}>{renderBlocks(parseBlocks(block.lines), key)}</blockquote>;
      case "hr":
        return <hr key={key} />;
      case "list": {
        const Tag = block.ordered ? "ol" : "ul";
        return (
          <Tag key={key} className={block.items.some((it) => it.checked !== null) ? "list-none pl-0" : undefined}>
            {block.items.map((item, j) => (
              <li key={`${key}-${j}`}>
                {item.checked !== null && <input type="checkbox" checked={item.checked} readOnly aria-label="task" />}
                {renderInline(item.text, `${key}-${j}`)}
                {item.children.length > 0 && renderBlocks(item.children, `${key}-${j}-c`)}
              </li>
            ))}
          </Tag>
        );
      }
      case "table":
        return (
          <div key={key} className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  {block.header.map((h, j) => (
                    <th key={j} style={{ textAlign: block.align[j] ?? undefined }}>
                      {renderInline(h, `${key}-h${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} style={{ textAlign: block.align[c] ?? undefined }}>
                        {renderInline(cell, `${key}-${r}-${c}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

function slugHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Render markdown to React nodes. Safe for untrusted input. */
export function renderMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  return renderBlocks(parseBlocks(lines));
}

export function Markdown({ content, className = "" }: { content: string; className?: string }) {
  if (!content?.trim()) return null;
  return <div className={`prose-ll ${className}`}>{renderMarkdown(content)}</div>;
}

/** Extract headings for a table of contents. */
export function extractHeadings(markdown: string): { level: number; text: string; id: string }[] {
  const out: { level: number; text: string; id: string }[] = [];
  for (const line of markdown.split("\n")) {
    const m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (m) out.push({ level: m[1]!.length, text: m[2]!, id: slugHeading(m[2]!) });
  }
  return out;
}
