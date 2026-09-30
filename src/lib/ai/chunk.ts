import type { TranscriptCue } from "@/lib/types";
import { estimateTokens, squashWhitespace } from "./text";

/**
 * Chunking for the AI tutor's course index.
 *
 * Course material is cut into passages of roughly 500–800 tokens with a small
 * overlap, so each excerpt sent to the model is self-contained and a fact that
 * straddles a boundary still appears whole in one of the two neighbours.
 * Fenced code blocks are never split.
 *
 * Pure: unit tested in tests/ai-tutor-chunking.test.ts.
 */

export interface ChunkOptions {
  /** A chunk is closed once it reaches this size. */
  targetTokens: number;
  /** Hard ceiling; single units above it are split further. */
  maxTokens: number;
  /** Tokens repeated from the end of one chunk at the start of the next. */
  overlapTokens: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { targetTokens: 600, maxTokens: 800, overlapTokens: 80 };

/** Split a paragraph into sentences (keeps the terminator). */
function sentences(paragraph: string): string[] {
  const parts = paragraph.match(/[^.!?。！？\n]+(?:[.!?。！？]+["')\]]*|\n|$)/gu);
  return (parts ?? [paragraph]).map((s) => s.trim()).filter(Boolean);
}

/** Split text that has no sentence breaks by words. */
function splitByWords(text: string, maxTokens: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    const candidate = [...current, word].join(" ");
    if (current.length && estimateTokens(candidate) > maxTokens) {
      out.push(current.join(" "));
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length) out.push(current.join(" "));
  // A single enormous "word" (minified code, a data URI) is cut by characters.
  return out.flatMap((part) => {
    if (estimateTokens(part) <= maxTokens) return [part];
    const size = maxTokens * 4;
    const pieces: string[] = [];
    for (let i = 0; i < part.length; i += size) pieces.push(part.slice(i, i + size));
    return pieces;
  });
}

/** Paragraphs, with fenced code blocks kept as single units. */
function paragraphs(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    const joined = buffer.join("\n").trim();
    if (joined) out.push(joined);
    buffer = [];
  };
  for (const line of lines) {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (fence) {
      buffer.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
        flush();
        fence = null;
      }
      continue;
    }
    if (marker) {
      flush();
      fence = marker;
      buffer.push(line);
      continue;
    }
    if (!line.trim()) flush();
    else buffer.push(line);
  }
  flush();
  return out;
}

/** Units no larger than `maxTokens`: paragraphs, else sentences, else word runs. */
function units(text: string, maxTokens: number): string[] {
  const out: string[] = [];
  for (const paragraph of paragraphs(text)) {
    if (estimateTokens(paragraph) <= maxTokens) {
      out.push(paragraph);
      continue;
    }
    if (/^\s*(```|~~~)/.test(paragraph)) {
      // Oversized code block: split by lines, re-fencing each piece so it still renders as code.
      const lines = paragraph.split("\n");
      const open = lines[0]!;
      const fenceChars = /^\s*(```+|~~~+)/.exec(open)?.[1] ?? "```";
      const body = lines.slice(1, lines[lines.length - 1]?.trim().startsWith(fenceChars[0]!) ? -1 : undefined);
      let current: string[] = [];
      for (const line of body) {
        if (current.length && estimateTokens([open, ...current, line, fenceChars].join("\n")) > maxTokens) {
          out.push([open, ...current, fenceChars].join("\n"));
          current = [];
        }
        current.push(line.length > maxTokens * 4 ? line.slice(0, maxTokens * 4) : line);
      }
      if (current.length) out.push([open, ...current, fenceChars].join("\n"));
      continue;
    }
    for (const sentence of sentences(paragraph)) {
      if (estimateTokens(sentence) <= maxTokens) out.push(sentence);
      else out.push(...splitByWords(sentence, maxTokens));
    }
  }
  return out;
}

function joinUnits(parts: string[]): string {
  return parts.join("\n\n");
}

/**
 * Cut `text` into chunks of about `targetTokens` (never above `maxTokens`),
 * repeating up to `overlapTokens` of trailing context at the start of the
 * next chunk.
 */
export function chunkText(text: string, options: Partial<ChunkOptions> = {}): string[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const maxTokens = Math.max(16, opts.maxTokens);
  const targetTokens = Math.min(Math.max(8, opts.targetTokens), maxTokens);
  const overlapTokens = Math.max(0, Math.min(opts.overlapTokens, Math.floor(targetTokens / 2)));
  const list = units(squashWhitespace(text), maxTokens);
  if (!list.length) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  // Units carried over as overlap; a chunk made only of them is not emitted.
  let carried = 0;

  const close = () => {
    if (current.length > carried) chunks.push(joinUnits(current));
    // Overlap: trailing units that fit in the overlap budget (never the whole chunk).
    const tail: string[] = [];
    let tailTokens = 0;
    for (let i = current.length - 1; i > 0; i--) {
      const t = estimateTokens(current[i]!);
      if (tailTokens + t > overlapTokens) break;
      tail.unshift(current[i]!);
      tailTokens += t;
    }
    current = tail;
    currentTokens = tailTokens;
    carried = tail.length;
  };

  for (const unit of list) {
    const t = estimateTokens(unit);
    if (current.length > carried && currentTokens + t > maxTokens) close();
    if (current.length && currentTokens + t > maxTokens) {
      // The overlap alone plus this unit is still too big: drop the overlap.
      current = [];
      currentTokens = 0;
      carried = 0;
    }
    current.push(unit);
    currentTokens += t;
    if (currentTokens >= targetTokens) close();
  }
  if (current.length > carried) chunks.push(joinUnits(current));
  return chunks;
}

export interface TranscriptChunk {
  text: string;
  /** Start of the first cue, in seconds. */
  start: number;
  end: number;
}

/**
 * Group consecutive transcript cues into windows of about `targetTokens`,
 * overlapping by whole cues. Each chunk keeps the timestamp of its first cue
 * so citations can jump to the right moment of the video.
 */
export function chunkTranscript(cues: TranscriptCue[], options: Partial<ChunkOptions> = {}): TranscriptChunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const clean = cues
    .filter((c) => c && typeof c.text === "string" && c.text.trim() && Number.isFinite(c.start))
    .map((c) => ({ start: Math.max(0, c.start), end: Number.isFinite(c.end) ? Math.max(c.start, c.end) : c.start, text: c.text.replace(/\s+/g, " ").trim() }))
    .sort((a, b) => a.start - b.start);
  const out: TranscriptChunk[] = [];
  let i = 0;
  while (i < clean.length) {
    let tokens = 0;
    let j = i;
    while (j < clean.length) {
      const t = estimateTokens(clean[j]!.text);
      if (j > i && tokens + t > opts.maxTokens) break;
      tokens += t;
      j++;
      if (tokens >= opts.targetTokens) break;
    }
    const window = clean.slice(i, j);
    out.push({ text: window.map((c) => c.text).join(" "), start: window[0]!.start, end: window[window.length - 1]!.end });
    if (j >= clean.length) break;
    // Step back over trailing cues that fit in the overlap budget.
    let back = j;
    let overlap = 0;
    while (back - 1 > i) {
      const t = estimateTokens(clean[back - 1]!.text);
      if (overlap + t > opts.overlapTokens) break;
      overlap += t;
      back--;
    }
    i = back;
  }
  return out;
}

export interface MarkdownHeading {
  level: number;
  /** Heading text without emphasis markers. */
  text: string;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

export interface CodeLimits {
  maxChars: number;
  maxLines: number;
}

/** The tutor quotes short snippets only; longer code examples are left out of the index. */
export const DEFAULT_CODE_LIMITS: CodeLimits = { maxChars: 2400, maxLines: 60 };

/** Whether a code snippet is short enough to be indexed. */
export function isShortCode(code: string, limits: CodeLimits = DEFAULT_CODE_LIMITS): boolean {
  const trimmed = code.trim();
  return !!trimmed && trimmed.length <= limits.maxChars && trimmed.split("\n").length <= limits.maxLines;
}

/**
 * Lesson markdown reduced to what helps retrieval and reads well in an
 * excerpt: images become their alt text, links their label (URLs carry no
 * meaning for the tutor), HTML tags and comments are dropped, and fenced
 * code blocks longer than `limits` are removed. Short code blocks are kept
 * verbatim, including their fences.
 */
export function cleanLessonMarkdown(markdown: string, limits: CodeLimits = DEFAULT_CODE_LIMITS): string {
  const out: string[] = [];
  let prose: string[] = [];
  let code: string[] | null = null;
  let fence = "";
  const flushProse = () => {
    if (!prose.length) return;
    out.push(
      prose
        .join("\n")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => (alt.trim() ? `(Image: ${alt.trim()})` : ""))
        .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
        .replace(/<\/?[a-z][^>]*>/gi, ""),
    );
    prose = [];
  };
  for (const line of normalizeNewlines(markdown).split("\n")) {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (code) {
      code.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
        if (isShortCode(code.slice(1, -1).join("\n"), limits)) out.push(code.join("\n"));
        code = null;
      }
      continue;
    }
    if (marker) {
      flushProse();
      code = [line];
      fence = marker;
      continue;
    }
    prose.push(line);
  }
  flushProse();
  // An unclosed fence runs to the end of the document (as markdown renders it).
  if (code && isShortCode(code.slice(1).join("\n"), limits)) out.push(`${code.join("\n")}\n${fence}`);
  return out.join("\n");
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** ATX headings of a markdown document, skipping lines inside code fences. */
export function markdownHeadings(markdown: string): MarkdownHeading[] {
  const out: MarkdownHeading[] = [];
  let inFence = false;
  for (const line of normalizeNewlines(markdown).split("\n")) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING_RE.exec(line);
    if (m) out.push({ level: m[1]!.length, text: m[2]!.replace(/[*_`]/g, "").trim() });
  }
  return out;
}

export interface MarkdownSection {
  /** Heading path, e.g. "Closures › Why they matter" (empty before the first heading). */
  heading: string;
  body: string;
}

/**
 * Split markdown into sections at headings (levels 1–4) so each chunk knows
 * which part of the lesson it came from. Headings inside code fences are
 * ignored.
 */
export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const path: string[] = [];
  let body: string[] = [];
  let inFence = false;
  const push = () => {
    const text = body.join("\n").trim();
    if (text) sections.push({ heading: path.filter(Boolean).join(" › "), body: text });
    body = [];
  };
  for (const line of normalizeNewlines(markdown).split("\n")) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING_RE.exec(line);
    if (m && m[1]!.length <= 4) {
      push();
      const level = m[1]!.length;
      path.length = level - 1;
      path[level - 1] = m[2]!.replace(/[*_`]/g, "").trim();
      continue;
    }
    body.push(line);
  }
  push();
  return sections;
}
