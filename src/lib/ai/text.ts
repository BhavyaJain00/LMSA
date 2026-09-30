/**
 * Text helpers shared by the AI tutor's retrieval (BM25), chunking and the
 * question clustering in the usage dashboard.
 *
 * Pure and dependency-free so it can run anywhere and be unit tested.
 */

/** Common English function words that carry no retrieval signal. */
const STOPWORDS = new Set(
  (
    "a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing " +
    "down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more " +
    "most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs " +
    "them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with " +
    "would you your yours yourself yourselves also get got let lets may might must shall us use used using via vs etc eg ie one ones please explain tell " +
    "mean means thing things something really does doesnt dont cant isnt wont im ive whats hows"
  ).split(/\s+/),
);

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

/**
 * Light suffix stripping so "arrays"/"array", "closures"/"closure" and
 * "declared"/"declare" meet. Deliberately conservative: it is applied to
 * both documents and queries, so consistency matters more than linguistics.
 */
export function stem(token: string): string {
  if (token.length <= 3 || /\d/.test(token)) return token;
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4 && !token.endsWith("eed")) return token.slice(0, -2);
  if (token.endsWith("es") && token.length > 4 && /(s|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2);
  if (token.endsWith("s") && !/(ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
}

/** Lower-case and strip accents (é → e) so queries typed without them still match. */
export function foldText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

const WORD_RE = /[\p{L}\p{N}_$]+/gu;

/**
 * Split text into retrieval terms: accent-folded, lower-cased, stopwords
 * removed, lightly stemmed. Identifiers written in camelCase or snake_case
 * also contribute their parts ("useState" → "usestate", "use", "state").
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const match of text.normalize("NFKD").replace(/\p{M}+/gu, "").matchAll(WORD_RE)) {
    const raw = match[0];
    const lower = raw.toLowerCase().replace(/^[_$]+|[_$]+$/g, "");
    if (!lower) continue;
    const parts = raw
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[\s_$]+/)
      .map((p) => p.toLowerCase())
      .filter(Boolean);
    const candidates = parts.length > 1 ? [lower.replace(/[_$]/g, ""), ...parts] : [lower];
    for (const token of candidates) {
      if (token.length < 2 && !/\d/.test(token)) continue;
      if (isStopword(token)) continue;
      out.push(stem(token));
    }
  }
  return out;
}

/**
 * Rough token count for budgeting prompt size (about four characters per
 * token for English prose and code; never less than one per word).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Math.max(Math.ceil(text.length / 4), words);
}

/** Cut text to roughly `maxTokens`, preferring a sentence or word boundary. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const maxChars = Math.max(1, maxTokens * 4);
  const slice = text.slice(0, maxChars);
  const sentence = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf(".\n"), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
  if (sentence > maxChars * 0.6) return `${slice.slice(0, sentence + 1)} …`;
  const space = slice.lastIndexOf(" ");
  return `${space > maxChars * 0.6 ? slice.slice(0, space) : slice} …`;
}

/** "125" → "2:05"; "3725" → "1:02:05". */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

const LESSON_DEICTIC_RE =
  /\b(?:this|the current|current) (?:lesson|video|page|section|chapter|topic|unit|module|lecture|part)\b|\b(?:summar(?:y|ies|i[sz]e)|recap|overview|tl;?dr|key (?:ideas|points|takeaways|concepts)|main (?:ideas|points))\b|\bwhat (?:is|was) (?:this|it) about\b/i;

/** Whether a question is about the lesson on screen ("summarise this lesson", "key points of this video"). */
export function refersToCurrentLesson(query: string): boolean {
  return LESSON_DEICTIC_RE.test(query);
}

/** Collapse whitespace and trim; keeps line breaks inside code fences intact. */
export function squashWhitespace(text: string): string {
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
