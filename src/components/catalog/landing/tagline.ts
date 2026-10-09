/** First sentence as the plain headline line, the rest as the accent line ("Learn by doing." / "Master real skills."). */
export function splitTagline(tagline: string): [string, string | null] {
  const text = tagline.trim();
  const match = text.match(/^(.+?[.!?])\s+(.+)$/u);
  return match ? [match[1]!, match[2]!] : [text, null];
}

/** One line of the editorial hero headline. */
export interface EditorialLine {
  text: string;
  /** "bold": grotesk capitals; "serif": italic serif word. */
  style: "bold" | "serif";
}

/**
 * Hero headline in the editorial style: for each of the first two sentences, the leading words as bold
 * capitals and the last word in italic serif ("Learn by doing. Master real skills." gives "LEARN BY" /
 * "doing." / "MASTER REAL" / "skills."). Further sentences join the second one; one-word sentences stay bold.
 * Capitals come from CSS, so screen readers still read the tagline as written.
 */
export function editorialLines(tagline: string): EditorialLine[] {
  const sentences = tagline.trim().split(/(?<=[.!?])\s+/u).filter(Boolean);
  const kept = sentences.length > 2 ? [sentences[0]!, sentences.slice(1).join(" ")] : sentences;
  const lines: EditorialLine[] = [];
  for (const sentence of kept) {
    const words = sentence.split(/\s+/u).filter(Boolean);
    if (words.length === 1) {
      lines.push({ text: words[0]!, style: "bold" });
    } else {
      lines.push({ text: words.slice(0, -1).join(" "), style: "bold" });
      lines.push({ text: words.at(-1)!, style: "serif" });
    }
  }
  return lines;
}
