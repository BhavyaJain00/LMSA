import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AiConversation, AiMessage, Database, Transcript } from "@/lib/types";
import { buildCourseChunks, collectCourseSources, conceptNote, describeChunk } from "@/lib/ai/sources";
import { FIXED_NOW, makeCourseTree, makeQuestion, makeQuiz } from "./helpers/db";

type SourceDb = Pick<Database, "courses" | "chapters" | "lessons" | "quizzes" | "questions" | "transcripts" | "aiConversations" | "aiMessages">;

const CORRECT_OPTION = "Zanzibar-const-keyword";
const WRONG_OPTION = "Quokka-var-keyword";
const ACCEPTED_ANSWER = "platypus-possibility";
const QUESTION_TEXT = "Which keyword creates a binding that cannot be reassigned (secret question)?";
const LEARNER_QUESTION = "My private question mentioning my employer AcmeCorp";

function fixture(): { db: SourceDb; ids: { course: string; l1: string; l2: string; l3: string; block: string } } {
  const { course, chapters, lessons } = makeCourseTree([[{ title: "Variables" }, { title: "Closures" }], [{ title: "Video lesson" }]], {
    course: {
      title: "JavaScript Basics",
      shortIntroduction: "Learn the core of JavaScript.",
      description: "A **practical** course. See [docs](https://example.com/docs).",
      outcomes: ["Write functions"],
      requirements: ["A browser"],
    },
  });
  const [l1, l2, l3] = lessons as [(typeof lessons)[0], (typeof lessons)[0], (typeof lessons)[0]];
  const question = makeQuestion({
    text: QUESTION_TEXT,
    options: [
      { id: "o1", text: CORRECT_OPTION, isCorrect: true, explanation: "Correct! Constants cannot be reassigned after they are declared." },
      { id: "o2", text: WRONG_OPTION, isCorrect: false, explanation: "Not quite — var declarations are function scoped. The correct answer is the other one." },
      { id: "o3", text: "Option three", isCorrect: false, explanation: "Wrong." },
    ],
  });
  const typed = makeQuestion({ type: "user_input", text: "Type the keyword", possibilities: [ACCEPTED_ANSWER], options: [] });
  const quiz = makeQuiz({ title: "Variables check", questions: [{ questionId: question.id, marks: 1 }, { questionId: typed.id, marks: 1 }] });
  const block = "blk_video";

  l1.blocks = [
    { id: "b1", type: "markdown", content: "Intro text.\n\n## Let and const\n\nUse `let` for values that change and `const` for values that do not." },
    { id: "b2", type: "callout", tone: "warning", content: "Never use var in new code." },
    { id: "b3", type: "code", language: "js", code: "const answer = 42;" },
    { id: "b4", type: "code", language: "js", code: "x();\n".repeat(100) },
    { id: "b5", type: "quiz", quizId: quiz.id },
    { id: "b6", type: "assignment", assignmentId: "asg_1" },
  ];
  l1.instructorNotes = "INSTRUCTOR-ONLY grading hints";
  l2.blocks = [{ id: "c1", type: "markdown", content: "# Closures\nA closure remembers its scope." }];
  l3.blocks = [{ id: block, type: "video", src: "/v.mp4", title: "Recursion walkthrough", transcriptId: "tr_processing" }];

  const transcripts: Transcript[] = [
    { id: "tr_processing", lessonId: l3.id, blockId: block, language: "en", cues: [], source: "auto", status: "processing", createdAt: FIXED_NOW, updatedAt: FIXED_NOW },
    {
      id: "tr_ready",
      lessonId: l3.id,
      blockId: block,
      language: "en",
      cues: [
        { start: 65, end: 70, text: "Recursion needs a base case." },
        { start: 70, end: 75, text: "Otherwise the stack overflows." },
      ],
      source: "upload",
      status: "ready",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    },
  ];

  const conversation: AiConversation = { id: "aic_1", userId: "usr_learner", courseId: course.id, lessonId: l2.id, title: LEARNER_QUESTION, createdAt: FIXED_NOW, updatedAt: FIXED_NOW };
  const messages: AiMessage[] = [
    { id: "aim_1", conversationId: conversation.id, role: "user", content: LEARNER_QUESTION, createdAt: FIXED_NOW },
    {
      id: "aim_2",
      conversationId: conversation.id,
      role: "assistant",
      content: "Closures copy variables.",
      reviewStatus: "corrected",
      instructorNote: "Closures keep a live reference to variables, they do not copy them.",
      createdAt: FIXED_NOW,
    },
    { id: "aim_3", conversationId: conversation.id, role: "assistant", content: "Approved answer", reviewStatus: "approved", instructorNote: "Looks good", createdAt: FIXED_NOW },
  ];

  return {
    db: { courses: [course], chapters, lessons, quizzes: [quiz], questions: [question, typed], transcripts, aiConversations: [conversation], aiMessages: messages },
    ids: { course: course.id, l1: l1.id, l2: l2.id, l3: l3.id, block },
  };
}

describe("ai tutor conceptNote", () => {
  it("removes verdicts so the note never says which option was right", () => {
    assert.equal(conceptNote("Correct! Constants cannot be reassigned."), "Constants cannot be reassigned.");
    assert.equal(conceptNote("✅ That's right: arrays are objects."), "Arrays are objects.");
    assert.equal(conceptNote("Not quite — var is function scoped."), "Var is function scoped.");
    assert.equal(conceptNote("Wrong."), "");
    assert.equal(conceptNote(undefined), "");
  });

  it("drops sentences that point at an answer", () => {
    assert.equal(conceptNote("Hoisting moves declarations up. The correct answer is B."), "Hoisting moves declarations up.");
    assert.equal(conceptNote("Option C is what you want. Scope is lexical."), "Scope is lexical.");
    assert.equal(conceptNote("You should pick the second option. Loops repeat work."), "Loops repeat work.");
    assert.equal(conceptNote("Answer: 42."), "");
    // Ordinary prose that merely contains "answer a" survives.
    assert.equal(conceptNote("Functions can answer a question by returning a value."), "Functions can answer a question by returning a value.");
  });
});

describe("ai tutor course sources", () => {
  it("indexes lesson markdown, callouts, short code, quiz notes, transcripts and clarifications", () => {
    const { db, ids } = fixture();
    const chunks = buildCourseChunks(db, ids.course);
    const kinds = new Set(chunks.map((c) => c.kind));
    for (const kind of ["overview", "lesson", "callout", "code", "quiz", "transcript", "clarification"]) assert.ok(kinds.has(kind as never), `missing ${kind}`);

    const lesson = chunks.find((c) => c.kind === "lesson" && c.text.includes("values that change"))!;
    assert.equal(lesson.title, "Variables › Let and const");
    assert.equal(describeChunk(lesson), 'Lesson "Variables" · section "Let and const"');

    assert.ok(chunks.some((c) => c.kind === "callout" && c.text === "Warning: Never use var in new code."));
    assert.ok(chunks.some((c) => c.kind === "code" && c.text.includes("const answer = 42;")));
    assert.ok(!chunks.some((c) => c.text.includes("x();\nx();\nx();")), "long code blocks must be left out");

    const overview = chunks.find((c) => c.kind === "overview")!;
    assert.equal(overview.lessonId, "");
    assert.ok(overview.text.includes("A practical course. See docs.") || overview.text.includes("A **practical** course. See docs."));
    assert.ok(overview.text.includes("Lessons in this course:") && overview.text.includes("1.2 Closures"));
    assert.ok(!overview.text.includes("https://example.com/docs"));
  });

  it("never includes quiz answers, options, questions, instructor notes or assignments", () => {
    const { db, ids } = fixture();
    const all = buildCourseChunks(db, ids.course)
      .map((c) => `${c.title}\n${c.text}`)
      .join("\n");
    for (const secret of [CORRECT_OPTION, WRONG_OPTION, ACCEPTED_ANSWER, QUESTION_TEXT, "INSTRUCTOR-ONLY", "asg_1", "Correct!", "correct answer", "Not quite"]) {
      assert.ok(!all.includes(secret), `index leaked: ${secret}`);
    }
    const quizNote = buildCourseChunks(db, ids.course).find((c) => c.kind === "quiz")!;
    assert.ok(quizNote.text.includes("Constants cannot be reassigned after they are declared."));
    assert.ok(quizNote.text.includes("Var declarations are function scoped."));
    assert.equal(quizNote.lessonId, ids.l1);
  });

  it("uses a ready transcript with timestamps when the linked one is still processing", () => {
    const { db, ids } = fixture();
    const transcript = buildCourseChunks(db, ids.course).find((c) => c.kind === "transcript")!;
    assert.equal(transcript.lessonId, ids.l3);
    assert.equal(transcript.seconds, 65);
    assert.equal(transcript.title, "Video lesson › Recursion walkthrough transcript");
    assert.equal(describeChunk(transcript), 'Lesson "Video lesson" · video at 1:05');
    assert.ok(transcript.text.startsWith("Recursion needs a base case."));
  });

  it("adds only the instructor's words of corrected answers, as trusted passages", () => {
    const { db, ids } = fixture();
    const chunks = buildCourseChunks(db, ids.course);
    const clarifications = chunks.filter((c) => c.kind === "clarification");
    assert.equal(clarifications.length, 1, "approved answers are not clarifications");
    assert.equal(clarifications[0]!.trusted, true);
    assert.equal(clarifications[0]!.lessonId, ids.l2);
    assert.ok(clarifications[0]!.text.includes("live reference"));
    const all = chunks.map((c) => c.text).join("\n");
    assert.ok(!all.includes("AcmeCorp"), "learner messages must never be indexed");
    assert.ok(!all.includes("Closures copy variables"), "the wrong answer itself must not be indexed");
  });

  it("returns nothing for an unknown course and ignores other courses' clarifications", () => {
    const { db, ids } = fixture();
    assert.deepEqual(collectCourseSources(db, "crs_missing"), []);
    db.aiConversations[0]!.courseId = "crs_other";
    assert.ok(!buildCourseChunks(db, ids.course).some((c) => c.kind === "clarification"));
  });

  it("gives chunks unique ids and outline order", () => {
    const { db, ids } = fixture();
    const chunks = buildCourseChunks(db, ids.course);
    assert.equal(new Set(chunks.map((c) => c.id)).size, chunks.length);
    assert.deepEqual(
      chunks.map((c) => c.order),
      chunks.map((_, i) => i),
    );
    const firstL3 = chunks.findIndex((c) => c.lessonId === ids.l3);
    const lastL1 = chunks.map((c) => c.lessonId).lastIndexOf(ids.l1);
    assert.ok(lastL1 < firstL3, "lessons must appear in outline order");
  });
});
