import type { Lesson } from "@/lib/types";
import { markdownHeadings } from "./chunk";

/**
 * Suggested first questions for the AI tutor, built from the headings of the
 * lesson the learner is on (pure; unit tested in tests/ai-tutor-prompt.test.ts).
 */

const GENERIC_HEADINGS = /^(introduction|intro|overview|summary|recap|conclusion|wrap[- ]?up|next steps?|resources|exercises?|quiz|practice|further reading|what's next)$/i;

function clean(heading: string): string {
  return heading.replace(/[*_`~]/g, "").replace(/\s+/g, " ").replace(/[:.?!]+$/, "").trim();
}

export function lessonStarterQuestions(lesson: Pick<Lesson, "title" | "blocks"> | null, courseTitle: string, max = 3): string[] {
  if (!lesson) {
    return [`What will I learn in ${courseTitle}?`, "Which lesson should I start with?", "What do I need to know before starting?"].slice(0, max);
  }
  const headings: string[] = [];
  for (const block of lesson.blocks) {
    if (block.type !== "markdown") continue;
    for (const h of markdownHeadings(block.content)) {
      const text = clean(h.text);
      if (h.level < 2 || h.level > 3 || text.length < 3 || text.length > 80 || GENERIC_HEADINGS.test(text)) continue;
      if (!headings.some((x) => x.toLowerCase() === text.toLowerCase())) headings.push(text);
    }
  }
  const out = headings.slice(0, max - 1).map((h) => `Can you explain “${h}” in simpler terms?`);
  out.push(`What are the key ideas of “${clean(lesson.title)}”?`);
  if (out.length < max) out.push("Can you give me another example of this?");
  return out.slice(0, max);
}
