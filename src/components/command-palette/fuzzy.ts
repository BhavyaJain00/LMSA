/**
 * Tiny fuzzy matcher shared by the command palette (client) and the search
 * route handler (server). Scores exact/prefix/word-start substring matches
 * highest, then multi-word matches, then in-order character subsequences.
 */

export interface FuzzyMatch {
  score: number;
  /** Character indices in the text that matched (for highlighting). */
  indices: number[];
}

const BOUNDARY = /[\s\-_/.,:()[\]]/;

function range(start: number, length: number): number[] {
  return Array.from({ length }, (_, i) => start + i);
}

export function normalize(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = normalize(query.trim());
  if (!q) return { score: 0, indices: [] };
  const t = normalize(text);
  if (!t) return null;

  // 1. Contiguous substring.
  const idx = t.indexOf(q);
  if (idx !== -1) {
    const wordStart = idx === 0 || BOUNDARY.test(t[idx - 1]!);
    const score = 1000 + (idx === 0 ? 400 : 0) + (wordStart ? 200 : 0) - idx - Math.max(0, t.length - q.length) * 0.2;
    return { score, indices: range(idx, q.length) };
  }

  // 2. Every word of the query appears somewhere.
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const indices: number[] = [];
    let score = 600;
    let ok = true;
    for (const token of tokens) {
      const i = t.indexOf(token);
      if (i === -1) {
        ok = false;
        break;
      }
      indices.push(...range(i, token.length));
      score -= i * 0.5;
      if (i === 0 || BOUNDARY.test(t[i - 1]!)) score += 20;
    }
    if (ok) return { score, indices: Array.from(new Set(indices)).sort((a, b) => a - b) };
  }

  // 3. Characters in order (e.g. "rnx" → "React & Next.js").
  const chars = q.replace(/\s+/g, "");
  if (chars.length < 2) return null;
  const indices: number[] = [];
  let cursor = 0;
  let score = 200;
  let prev = -2;
  for (const ch of chars) {
    const found = t.indexOf(ch, cursor);
    if (found === -1) return null;
    indices.push(found);
    if (found === prev + 1) score += 6;
    else score -= Math.min(20, found - cursor);
    if (found === 0 || BOUNDARY.test(t[found - 1]!)) score += 10;
    prev = found;
    cursor = found + 1;
  }
  // Very scattered matches are noise.
  const spread = indices[indices.length - 1]! - indices[0]!;
  if (spread > chars.length * 4 + 8) return null;
  return score > 60 ? { score, indices } : null;
}

export interface Segment {
  text: string;
  match: boolean;
}

/** Split text into matched / unmatched runs for <mark> highlighting. */
export function highlightSegments(text: string, indices: number[]): Segment[] {
  if (!indices.length) return [{ text, match: false }];
  const set = new Set(indices);
  const out: Segment[] = [];
  for (let i = 0; i < text.length; i++) {
    const match = set.has(i);
    const last = out[out.length - 1];
    if (last && last.match === match) last.text += text[i];
    else out.push({ text: text[i]!, match });
  }
  return out;
}
