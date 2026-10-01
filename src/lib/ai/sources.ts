import type { Database, Lesson, Question, Transcript, TranscriptCue } from "@/lib/types";
import { chunkText, chunkTranscript, cleanLessonMarkdown, DEFAULT_CODE_LIMITS, isShortCode, splitMarkdownSections, type ChunkOptions } from "./chunk";
import { formatTimestamp } from "./text";

/**
 * What the AI tutor may read about a course, turned into retrievable chunks.
 *
 * Included: the course overview, lesson markdown (split at headings),
 * callouts, short code blocks, quiz explanations and video transcripts, plus
 * instructor clarifications written in the review queue.
 *
 * Never included: quiz options, which option is correct, accepted answers of
 * typed questions, the quiz questions themselves, instructor-only lesson
 * notes, assignments/exercises, and anything written by learners (a
 * clarification contributes only the instructor's own words, never the
 * learner question it answered).
 *
 * Two steps so the index can be cached cheaply: `collectCourseSources` reads
 * the raw material (a small, serialisable list that is hashed to detect
 * changes) and `chunkCourseSources` cuts it into passages.
 *
 * Pure (reads a database snapshot): unit tested in tests/ai-tutor-sources.test.ts.
 */

export type ChunkKind = "overview" | "lesson" | "callout" | "code" | "quiz" | "transcript" | "clarification";

export interface CourseChunk {
  /** Stable id within the index (used for de-duplication). */
  id: string;
  /** "" for the course overview (links to the course page). */
  lessonId: string;
  lessonTitle: string;
  /** Title used for the title boost, e.g. "Closures › Why they matter". */
  title: string;
  kind: ChunkKind;
  text: string;
  /** Video position for transcript chunks. */
  seconds?: number;
  /** Video block of a transcript chunk. */
  blockId?: string;
  /** Written or verified by course staff (instructor clarifications). */
  trusted?: boolean;
  /** Outline position, for stable ordering of equal scores. */
  order: number;
}

/** Raw material of one passage family, before chunking. */
export interface CourseSource {
  lessonId: string;
  lessonTitle: string;
  title: string;
  kind: ChunkKind;
  /** Text to chunk (unused for transcripts, which carry `cues`). */
  text: string;
  cues?: TranscriptCue[];
  /** Video block a transcript source belongs to. */
  blockId?: string;
  trusted?: boolean;
}

type SourceDb = Pick<Database, "courses" | "chapters" | "lessons" | "quizzes" | "questions" | "transcripts" | "aiConversations" | "aiMessages">;

const CALLOUT_LABEL: Record<string, string> = { info: "Note", success: "Tip", warning: "Warning", danger: "Important" };

const VERDICT_RE =
  /^(?:correct|incorrect|right|wrong|yes|no|nope|true|false|exactly|not quite|not really|well done|great job|good job|nice|spot on|close|almost|that'?s (?:right|correct|wrong|incorrect|it|not it)|this is (?:right|correct|wrong|incorrect)|(?:the )?(?:right|correct|wrong|incorrect|best) (?:answer|choice|option))(?:\s*[!.:;,]+|\s*[—–]|\s+-)\s*/i;

/**
 * Sentences that point at an answer rather than explain a concept:
 * "The correct answer is B.", "Option C is right", "so you should pick the
 * second one", "Answer: 42".
 */
const ANSWER_SENTENCE_RE =
  /\b(?:(?:correct|right|wrong|incorrect|best|only valid) (?:answer|choice|option|response)s?|answer (?:is|was|would be)|answer\s*:|(?:first|second|third|fourth|fifth|last|other) (?:option|choice|answer)|(?:pick|choose|select|tick)(?:ed|ing)? (?:this|that) (?:one|option|choice|answer)|should (?:pick|choose|select|tick)|this (?:option|choice) is|is (?:the )?(?:correct|right|wrong|incorrect)(?![\p{L}]))/iu;
/** "option B", "Choice 3", "answer (c)" (a lowercase letter alone is ordinary prose: "answer a question"). */
const OPTION_REF_RE = /\b(?:[Oo]ption|[Cc]hoice|[Aa]nswer)s?\s+(?:[A-H]|[1-9]|\([a-hA-H1-9]\))(?![\p{L}\p{N}])/u;

/** Split prose into sentences, keeping terminators. */
function sentencesOf(text: string): string[] {
  return (text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/**
 * An option explanation as a neutral concept note: leading verdicts
 * ("Correct!", "✅ Not quite —", "That's wrong:") and sentences that point at
 * an answer ("The right choice is B.") are removed, so the note explains the
 * idea without telling which option was the right one. Returns "" when
 * nothing useful remains.
 */
export function conceptNote(explanation: string | undefined): string {
  let text = (explanation ?? "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    const next = text.replace(/^[^\p{L}\p{N}]+/u, "").replace(VERDICT_RE, "").trim();
    if (next === text) break;
    text = next;
  }
  text = sentencesOf(text)
    .filter((s) => !ANSWER_SENTENCE_RE.test(s) && !OPTION_REF_RE.test(s))
    .join(" ")
    .trim();
  if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 8) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Explanations of a quiz's questions without revealing which option is right. */
function quizNotes(questions: Question[]): string[] {
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const q of questions) {
    for (const option of q.options) {
      const text = conceptNote(option.explanation);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      notes.push(`- ${text}`);
    }
  }
  return notes;
}

/** Lessons of a course in outline order (chapter order, then lesson order). */
export function orderedLessons(db: Pick<Database, "chapters" | "lessons">, courseId: string): { lesson: Lesson; chapterTitle: string; chapterNumber: number; lessonNumber: number }[] {
  const chapters = db.chapters.filter((c) => c.courseId === courseId).sort((a, b) => a.order - b.order);
  const out: { lesson: Lesson; chapterTitle: string; chapterNumber: number; lessonNumber: number }[] = [];
  chapters.forEach((chapter, ci) => {
    db.lessons
      .filter((l) => l.chapterId === chapter.id)
      .sort((a, b) => a.order - b.order)
      .forEach((lesson, li) => out.push({ lesson, chapterTitle: chapter.title, chapterNumber: ci + 1, lessonNumber: li + 1 }));
  });
  return out;
}

/** The ready transcript of a video block: the one it points at, else any ready one for the block. */
function blockTranscript(transcripts: Transcript[], byId: Map<string, Transcript>, lessonId: string, blockId: string, transcriptId?: string): Transcript | undefined {
  const linked = transcriptId ? byId.get(transcriptId) : undefined;
  if (linked && linked.status === "ready" && linked.cues.length) return linked;
  return transcripts.find((t) => t.lessonId === lessonId && t.blockId === blockId && t.status === "ready" && t.cues.length > 0);
}

/** Everything the tutor may read about a course, in outline order (empty for an unknown course). */
export function collectCourseSources(db: SourceDb, courseId: string): CourseSource[] {
  const course = db.courses.find((c) => c.id === courseId);
  if (!course) return [];
  const sources: CourseSource[] = [];
  const lessons = orderedLessons(db, courseId);

  // Course overview: what the course covers, who it is for and its outline.
  const overview = [
    course.shortIntroduction,
    course.description ? cleanLessonMarkdown(course.description) : "",
    course.outcomes.length ? `What you will learn:\n${course.outcomes.map((o) => `- ${o}`).join("\n")}` : "",
    course.requirements.length ? `Requirements:\n${course.requirements.map((r) => `- ${r}`).join("\n")}` : "",
    lessons.length ? `Lessons in this course:\n${lessons.map((l) => `- ${l.chapterNumber}.${l.lessonNumber} ${l.lesson.title} (${l.chapterTitle})`).join("\n")}` : "",
  ]
    .filter((s) => s && s.trim())
    .join("\n\n");
  if (overview) sources.push({ lessonId: "", lessonTitle: course.title, title: `${course.title} › Course overview`, kind: "overview", text: overview });

  const quizzes = new Map(db.quizzes.map((q) => [q.id, q]));
  const questions = new Map(db.questions.map((q) => [q.id, q]));
  const transcriptsById = new Map(db.transcripts.map((t) => [t.id, t]));

  for (const { lesson } of lessons) {
    const base = { lessonId: lesson.id, lessonTitle: lesson.title };
    const quizIds = new Set<string>();

    for (const block of lesson.blocks) {
      switch (block.type) {
        case "markdown": {
          for (const section of splitMarkdownSections(block.content)) {
            const text = cleanLessonMarkdown(section.body).trim();
            if (!text) continue;
            sources.push({ ...base, title: section.heading ? `${lesson.title} › ${section.heading}` : lesson.title, kind: "lesson", text });
          }
          break;
        }
        case "callout": {
          const text = cleanLessonMarkdown(block.content).trim();
          if (text) sources.push({ ...base, title: lesson.title, kind: "callout", text: `${CALLOUT_LABEL[block.tone] ?? "Note"}: ${text}` });
          break;
        }
        case "code": {
          if (!isShortCode(block.code, DEFAULT_CODE_LIMITS)) break;
          sources.push({ ...base, title: `${lesson.title} › Code example`, kind: "code", text: `\`\`\`${block.language || ""}\n${block.code.trim()}\n\`\`\`` });
          break;
        }
        case "quiz":
          quizIds.add(block.quizId);
          break;
        case "video": {
          for (const marker of block.quizMarkers ?? []) quizIds.add(marker.quizId);
          const transcript = blockTranscript(db.transcripts, transcriptsById, lesson.id, block.id, block.transcriptId);
          if (!transcript) break;
          const videoTitle = block.title?.trim() || "Video";
          sources.push({ ...base, title: `${lesson.title} › ${videoTitle} transcript`, kind: "transcript", text: "", cues: transcript.cues, blockId: block.id });
          break;
        }
        default:
          break;
      }
    }

    // Quiz explanations as concept notes: never the questions, the options, the correct choice or accepted answers.
    for (const quizId of quizIds) {
      const quiz = quizzes.get(quizId);
      if (!quiz) continue;
      const notes = quizNotes(quiz.questions.map((ref) => questions.get(ref.questionId)).filter((q): q is Question => !!q));
      if (!notes.length) continue;
      sources.push({ ...base, title: `${lesson.title} › Quiz concept notes`, kind: "quiz", text: `Concept notes from the lesson quiz "${quiz.title}":\n${notes.join("\n")}` });
    }
  }

  // Instructor clarifications from the review queue (trusted; the instructor's words only).
  const lessonTitles = new Map(lessons.map((l) => [l.lesson.id, l.lesson.title]));
  const conversations = new Map(db.aiConversations.filter((c) => c.courseId === courseId).map((c) => [c.id, c]));
  const clarifications = db.aiMessages
    .filter((m) => m.role === "assistant" && m.reviewStatus === "corrected" && !!m.instructorNote?.trim() && conversations.has(m.conversationId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const message of clarifications) {
    const conversation = conversations.get(message.conversationId)!;
    const lessonId =
      [conversation.lessonId, ...(message.citations ?? []).map((c) => c.lessonId)].find((id): id is string => !!id && lessonTitles.has(id)) ?? "";
    const lessonTitle = lessonId ? lessonTitles.get(lessonId)! : course.title;
    sources.push({ lessonId, lessonTitle, title: `${lessonTitle} › Instructor clarification`, kind: "clarification", text: message.instructorNote!.trim(), trusted: true });
  }

  return sources;
}

/** Cut collected sources into retrievable passages of about 500–800 tokens. */
export function chunkCourseSources(sources: CourseSource[], options: Partial<ChunkOptions> = {}): CourseChunk[] {
  const chunks: CourseChunk[] = [];
  const add = (source: CourseSource, text: string, seconds?: number) => {
    const chunk: CourseChunk = {
      id: `${source.lessonId || "course"}:${source.kind}:${chunks.length}`,
      lessonId: source.lessonId,
      lessonTitle: source.lessonTitle,
      title: source.title,
      kind: source.kind,
      text,
      order: chunks.length,
    };
    if (seconds !== undefined) chunk.seconds = seconds;
    if (source.blockId) chunk.blockId = source.blockId;
    if (source.trusted) chunk.trusted = true;
    chunks.push(chunk);
  };
  for (const source of sources) {
    if (source.kind === "transcript") {
      for (const piece of chunkTranscript(source.cues ?? [], options)) add(source, piece.text, Math.floor(piece.start));
    } else if (source.kind === "code") {
      // Short by construction; never split a snippet.
      add(source, source.text);
    } else {
      for (const text of chunkText(source.text, options)) add(source, text);
    }
  }
  return chunks;
}

/** Build every retrievable chunk for a course from a database snapshot. */
export function buildCourseChunks(db: SourceDb, courseId: string, options: Partial<ChunkOptions> = {}): CourseChunk[] {
  return chunkCourseSources(collectCourseSources(db, courseId), options);
}

/** One-line label of where an excerpt comes from, used in the prompt and on citation chips. */
export function describeChunk(chunk: Pick<CourseChunk, "kind" | "lessonTitle" | "title" | "seconds">): string {
  switch (chunk.kind) {
    case "lesson": {
      const prefix = `${chunk.lessonTitle} › `;
      const section = chunk.title.startsWith(prefix) ? chunk.title.slice(prefix.length) : "";
      return section ? `Lesson "${chunk.lessonTitle}" · section "${section}"` : `Lesson "${chunk.lessonTitle}"`;
    }
    case "overview":
      return `Course overview`;
    case "transcript":
      return `Lesson "${chunk.lessonTitle}" · video at ${formatTimestamp(chunk.seconds ?? 0)}`;
    case "clarification":
      return `Instructor clarification · lesson "${chunk.lessonTitle}"`;
    case "quiz":
      return `Lesson "${chunk.lessonTitle}" · quiz concept notes`;
    case "code":
      return `Lesson "${chunk.lessonTitle}" · code example`;
    default:
      return `Lesson "${chunk.lessonTitle}"`;
  }
}
