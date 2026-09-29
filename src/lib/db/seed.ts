import "server-only";
import type {
  Activity,
  Announcement,
  Assignment,
  AssignmentSubmission,
  Badge,
  BadgeAssignment,
  Batch,
  BatchEnrollment,
  Category,
  Certificate,
  Chapter,
  Coupon,
  Course,
  Database,
  DiscussionReply,
  DiscussionTopic,
  EmailTemplate,
  Enrollment,
  EvaluatorSlot,
  ExerciseSubmission,
  JobApplication,
  JobOpening,
  Lesson,
  LessonBlock,
  LessonNote,
  LessonProgress,
  LiveClass,
  Notification,
  Payment,
  Program,
  ProgramMember,
  ProgrammingExercise,
  Question,
  Quiz,
  QuizSubmission,
  Review,
  User,
  VideoWatch,
} from "@/lib/types";
import { hashPassword } from "@/lib/auth/password";
import { defaultSettings } from "./defaults";
import { readingTimeSeconds, toDateKey, addDays } from "@/lib/utils";

/**
 * Demo data loaded on first run (and via Admin → Settings → "Load demo data").
 * All demo accounts use the password `password123`.
 */

const NOW = new Date();
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(addDays(NOW, -n));
const dateKeyIn = (n: number) => toDateKey(addDays(NOW, n));

/** Public-domain sample videos (Blender Foundation films) served as plain MP4 files. */
const BUCKET = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample";
const VIDEOS = {
  bunny: { src: `${BUCKET}/BigBuckBunny.mp4`, poster: `${BUCKET}/images/BigBuckBunny.jpg`, duration: 596 },
  elephants: { src: `${BUCKET}/ElephantsDream.mp4`, poster: `${BUCKET}/images/ElephantsDream.jpg`, duration: 653 },
  sintel: { src: `${BUCKET}/Sintel.mp4`, poster: `${BUCKET}/images/Sintel.jpg`, duration: 888 },
  tears: { src: `${BUCKET}/TearsOfSteel.mp4`, poster: `${BUCKET}/images/TearsOfSteel.jpg`, duration: 734 },
  blazes: { src: `${BUCKET}/ForBiggerBlazes.mp4`, poster: `${BUCKET}/images/ForBiggerBlazes.jpg`, duration: 15 },
  escapes: { src: `${BUCKET}/ForBiggerEscapes.mp4`, poster: `${BUCKET}/images/ForBiggerEscapes.jpg`, duration: 15 },
  fun: { src: `${BUCKET}/ForBiggerFun.mp4`, poster: `${BUCKET}/images/ForBiggerFun.jpg`, duration: 60 },
  joyrides: { src: `${BUCKET}/ForBiggerJoyrides.mp4`, poster: `${BUCKET}/images/ForBiggerJoyrides.jpg`, duration: 15 },
  meltdowns: { src: `${BUCKET}/ForBiggerMeltdowns.mp4`, poster: `${BUCKET}/images/ForBiggerMeltdowns.jpg`, duration: 15 },
  subaru: { src: `${BUCKET}/SubaruOutbackOnStreetAndDirt.mp4`, poster: `${BUCKET}/images/SubaruOutbackOnStreetAndDirt.jpg`, duration: 594 },
  bullrun: { src: `${BUCKET}/WeAreGoingOnBullrun.mp4`, poster: `${BUCKET}/images/WeAreGoingOnBullrun.jpg`, duration: 47 },
  gti: { src: `${BUCKET}/VolkswagenGTIReview.mp4`, poster: `${BUCKET}/images/VolkswagenGTIReview.jpg`, duration: 610 },
  grand: { src: `${BUCKET}/WhatCarCanYouGetForAGrand.mp4`, poster: `${BUCKET}/images/WhatCarCanYouGetForAGrand.jpg`, duration: 594 },
} as const;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let blockCounter = 0;
const bid = () => `blk_${(++blockCounter).toString(36).padStart(4, "0")}`;

const md = (content: string): LessonBlock => ({ id: bid(), type: "markdown", content: content.trim() });
const video = (
  v: (typeof VIDEOS)[keyof typeof VIDEOS],
  title: string,
  extra: Partial<Extract<LessonBlock, { type: "video" }>> = {},
): LessonBlock => ({
  id: bid(),
  type: "video",
  src: v.src,
  posterUrl: v.poster,
  duration: v.duration,
  title,
  ...extra,
});
const callout = (tone: "info" | "success" | "warning" | "danger", content: string): LessonBlock => ({
  id: bid(),
  type: "callout",
  tone,
  content,
});
const code = (language: string, source: string): LessonBlock => ({ id: bid(), type: "code", language, code: source.trim() });
const quizBlock = (quizId: string): LessonBlock => ({ id: bid(), type: "quiz", quizId });
const assignmentBlock = (assignmentId: string): LessonBlock => ({ id: bid(), type: "assignment", assignmentId });
const exerciseBlock = (exerciseId: string): LessonBlock => ({ id: bid(), type: "exercise", exerciseId });

function lessonDuration(blocks: LessonBlock[]): number {
  let total = 0;
  for (const b of blocks) {
    if (b.type === "video") total += b.duration ?? 0;
    else if (b.type === "markdown") total += readingTimeSeconds(b.content);
    else if (b.type === "quiz") total += 300;
    else if (b.type === "assignment" || b.type === "exercise") total += 900;
    else total += 60;
  }
  return total;
}

interface LessonSpec {
  id: string;
  slug: string;
  title: string;
  blocks: LessonBlock[];
  preview?: boolean;
  instructorNotes?: string;
}

interface ChapterSpec {
  id: string;
  title: string;
  description?: string;
  lessons: LessonSpec[];
}

function buildOutline(courseId: string, chapters: ChapterSpec[]): { chapters: Chapter[]; lessons: Lesson[] } {
  const outChapters: Chapter[] = [];
  const outLessons: Lesson[] = [];
  chapters.forEach((ch, ci) => {
    outChapters.push({ id: ch.id, courseId, title: ch.title, description: ch.description, order: ci + 1 });
    ch.lessons.forEach((ls, li) => {
      outLessons.push({
        id: ls.id,
        courseId,
        chapterId: ch.id,
        slug: ls.slug,
        title: ls.title,
        order: li + 1,
        blocks: ls.blocks,
        instructorNotes: ls.instructorNotes,
        includeInPreview: !!ls.preview,
        durationSeconds: lessonDuration(ls.blocks),
        createdAt: daysAgo(40),
        updatedAt: daysAgo(3),
      });
    });
  });
  return { chapters: outChapters, lessons: outLessons };
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

async function buildUsers(): Promise<User[]> {
  const passwordHash = await hashPassword("password123");
  const base = (u: Partial<User> & Pick<User, "id" | "username" | "name" | "email" | "roles">): User => ({
    passwordHash,
    enabled: true,
    createdAt: daysAgo(120),
    lastActiveAt: daysAgo(1),
    personaCaptured: true,
    ...u,
  });
  return [
    base({
      id: "usr_admin",
      username: "admin",
      name: "Admin User",
      email: "admin@learnloop.test",
      roles: ["admin", "moderator", "course_creator", "batch_evaluator"],
      headline: "Platform administrator",
      bio: "Keeps the lights on.",
    }),
    base({
      id: "usr_maya",
      username: "maya",
      name: "Maya Chen",
      email: "maya@learnloop.test",
      roles: ["course_creator", "moderator"],
      headline: "Senior Frontend Engineer & Instructor",
      bio: "I have shipped JavaScript to millions of users at two unicorns and now teach what I wish someone had taught me. **Practical**, project-based, no fluff.",
      location: "San Francisco, CA",
      socials: { website: "https://example.com", github: "https://github.com", linkedin: "https://linkedin.com", x: "https://x.com" },
      skills: ["JavaScript", "React", "Next.js", "TypeScript", "Teaching"],
      workExperience: [
        { id: "we1", company: "Nimbus Labs", title: "Staff Engineer", startDate: "2021-03", current: true, description: "Web platform and design systems." },
        { id: "we2", company: "Orbit", title: "Senior Engineer", startDate: "2017-06", endDate: "2021-02" },
      ],
      education: [{ id: "ed1", institution: "UC Berkeley", degree: "B.S.", fieldOfStudy: "Computer Science", startYear: 2011, endYear: 2015 }],
    }),
    base({
      id: "usr_daniel",
      username: "daniel",
      name: "Daniel Okafor",
      email: "daniel@learnloop.test",
      roles: ["course_creator"],
      headline: "Data scientist, Python educator",
      bio: "Former analytics lead. I teach Python and data analysis with real datasets.",
      location: "Lagos, Nigeria",
      skills: ["Python", "Pandas", "SQL", "Statistics"],
    }),
    base({
      id: "usr_priya",
      username: "priya",
      name: "Priya Raman",
      email: "priya@learnloop.test",
      roles: ["batch_evaluator", "moderator"],
      headline: "Product designer & certification evaluator",
      bio: "I evaluate final projects and run design critiques for cohorts.",
      location: "Bengaluru, India",
      skills: ["Figma", "Design Systems", "Accessibility"],
    }),
    base({
      id: "usr_alex",
      username: "alex",
      name: "Alex Johnson",
      email: "alex@learnloop.test",
      roles: ["student"],
      headline: "Career switcher learning web development",
      location: "Austin, TX",
      createdAt: daysAgo(45),
      persona: { role: "Career switcher", industry: "Software", goals: ["Get a job", "Build projects"], referrer: "Friend" },
    }),
    base({
      id: "usr_sofia",
      username: "sofia",
      name: "Sofia Martinez",
      email: "sofia@learnloop.test",
      roles: ["student"],
      headline: "Marketing manager picking up code",
      location: "Madrid, Spain",
      createdAt: daysAgo(80),
    }),
    base({
      id: "usr_liam",
      username: "liam",
      name: "Liam Walker",
      email: "liam@learnloop.test",
      roles: ["student"],
      location: "Toronto, Canada",
      createdAt: daysAgo(20),
      personaCaptured: false,
    }),
    base({
      id: "usr_emma",
      username: "emma",
      name: "Emma Brown",
      email: "emma@learnloop.test",
      roles: ["student"],
      location: "London, UK",
      createdAt: daysAgo(10),
    }),
  ];
}

/* ------------------------------------------------------------------ */
/* Question bank, quizzes, assignments, exercises                      */
/* ------------------------------------------------------------------ */

function q(
  id: string,
  text: string,
  options: [string, boolean, string?][],
  extra: Partial<Question> = {},
): Question {
  return {
    id,
    text,
    type: "choices",
    multiple: options.filter((o) => o[1]).length > 1,
    marks: 1,
    options: options.map((o, i) => ({ id: `${id}_o${i + 1}`, text: o[0], isCorrect: o[1], explanation: o[2] })),
    possibilities: [],
    authorId: "usr_maya",
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
    ...extra,
  };
}

const questions: Question[] = [
  q("qst_js_01", "Which keyword declares a block-scoped variable that **cannot** be reassigned?", [
    ["var", false],
    ["let", false, "`let` is block-scoped but can be reassigned."],
    ["const", true, "`const` bindings cannot be reassigned."],
    ["static", false],
  ]),
  q("qst_js_02", "What does `typeof null` evaluate to?", [
    ['"null"', false],
    ['"object"', true, "A long-standing quirk of the language."],
    ['"undefined"', false],
    ['"boolean"', false],
  ]),
  q("qst_js_03", "Which of these are **falsy** values in JavaScript? (select all)", [
    ["0", true],
    ['""', true],
    ["[]", false, "An empty array is truthy."],
    ["NaN", true],
  ]),
  q("qst_js_04", "Which array method returns a **new** array with the elements that pass a test?", [
    ["forEach", false],
    ["filter", true],
    ["find", false, "`find` returns a single element."],
    ["reduce", false],
  ]),
  q("qst_js_05", "What is the output of `[1, 2, 3].map(n => n * 2)`?", [
    ["[2, 4, 6]", true],
    ["[1, 2, 3, 2, 4, 6]", false],
    ["6", false],
    ["undefined", false],
  ]),
  q("qst_js_06", "Promises: which method runs when a promise is **rejected**?", [
    [".then()", false],
    [".catch()", true],
    [".finally()", false, "`finally` runs in both cases."],
    [".await()", false],
  ]),
  {
    id: "qst_js_07",
    text: "Type the operator used for strict equality comparison.",
    type: "user_input",
    multiple: false,
    marks: 1,
    options: [],
    possibilities: ["===", "strict equality", "triple equals"],
    authorId: "usr_maya",
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
  },
  {
    id: "qst_js_08",
    text: "In your own words, explain the difference between `==` and `===`.",
    type: "open_ended",
    multiple: false,
    marks: 2,
    options: [],
    possibilities: [],
    authorId: "usr_maya",
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
  },
  q("qst_react_01", "What hook lets you keep state in a function component?", [
    ["useEffect", false],
    ["useState", true],
    ["useMemo", false],
    ["useRef", false],
  ]),
  q("qst_react_02", "In the Next.js App Router, which file defines shared UI for a route segment and its children?", [
    ["page.tsx", false],
    ["layout.tsx", true],
    ["template.tsx", false, "Templates re-mount on navigation."],
    ["route.ts", false],
  ]),
  q("qst_react_03", "Server Components can… (select all that apply)", [
    ["read from a database directly", true],
    ["use useState", false],
    ["be async functions", true],
    ["attach onClick handlers", false],
  ]),
  q("qst_react_04", "Which directive marks a file as a Client Component?", [
    ['"use client"', true],
    ['"use server"', false],
    ['"client only"', false],
    ['"use browser"', false],
  ]),
  q("qst_design_01", "Which principle says related items should be placed close together?", [
    ["Contrast", false],
    ["Proximity", true],
    ["Repetition", false],
    ["Alignment", false],
  ]),
  q("qst_design_02", "What is the minimum WCAG AA contrast ratio for normal body text?", [
    ["2:1", false],
    ["3:1", false, "3:1 is for large text."],
    ["4.5:1", true],
    ["7:1", false, "7:1 is AAA."],
  ]),
  q("qst_py_01", "Which pandas method returns the first 5 rows of a DataFrame?", [
    ["df.top()", false],
    ["df.head()", true],
    ["df.first()", false],
    ["df.peek()", false],
  ]),
  q("qst_py_02", "What does `df.groupby('city').mean()` compute?", [
    ["The mean of every numeric column per city", true],
    ["The number of rows per city", false],
    ["The first row per city", false],
    ["Nothing — it raises an error", false],
  ]),
];

const quizzes: Quiz[] = [
  {
    id: "quiz_js_basics",
    title: "JavaScript Basics Check",
    courseId: "crs_js",
    lessonId: "les_js_1_4",
    questions: ["qst_js_01", "qst_js_02", "qst_js_03", "qst_js_04", "qst_js_05", "qst_js_06", "qst_js_07"].map((id) => ({ questionId: id, marks: 1 })),
    maxAttempts: 3,
    showAnswers: true,
    showSubmissionHistory: true,
    passingPercentage: 70,
    totalMarks: 7,
    shuffleQuestions: true,
    limitQuestionsTo: 0,
    durationSeconds: 600,
    enableNegativeMarking: false,
    marksToCut: 0,
    enableScheduling: false,
    enableProctoring: false,
    maxViolations: 3,
    authorId: "usr_maya",
    createdAt: daysAgo(30),
    updatedAt: daysAgo(5),
  },
  {
    id: "quiz_js_final",
    title: "JavaScript Final Exam",
    courseId: "crs_js",
    lessonId: "les_js_3_3",
    questions: [
      ...["qst_js_01", "qst_js_02", "qst_js_03", "qst_js_04", "qst_js_05", "qst_js_06", "qst_js_07"].map((id) => ({ questionId: id, marks: 1 })),
      { questionId: "qst_js_08", marks: 2 },
    ],
    maxAttempts: 1,
    showAnswers: false,
    showSubmissionHistory: true,
    passingPercentage: 75,
    totalMarks: 9,
    shuffleQuestions: true,
    limitQuestionsTo: 0,
    durationSeconds: 900,
    enableNegativeMarking: true,
    marksToCut: 1,
    enableScheduling: false,
    enableProctoring: true,
    maxViolations: 3,
    authorId: "usr_maya",
    createdAt: daysAgo(30),
    updatedAt: daysAgo(5),
  },
  {
    id: "quiz_react_app_router",
    title: "App Router Fundamentals",
    courseId: "crs_react",
    lessonId: "les_react_1_3",
    questions: ["qst_react_01", "qst_react_02", "qst_react_03", "qst_react_04"].map((id) => ({ questionId: id, marks: 1 })),
    maxAttempts: 0,
    showAnswers: true,
    showSubmissionHistory: false,
    passingPercentage: 60,
    totalMarks: 4,
    shuffleQuestions: false,
    limitQuestionsTo: 0,
    durationSeconds: 0,
    enableNegativeMarking: false,
    marksToCut: 0,
    enableScheduling: false,
    enableProctoring: false,
    maxViolations: 3,
    authorId: "usr_maya",
    createdAt: daysAgo(25),
    updatedAt: daysAgo(2),
  },
  {
    id: "quiz_design_basics",
    title: "Design Principles Quiz",
    courseId: "crs_design",
    lessonId: "les_design_1_3",
    questions: ["qst_design_01", "qst_design_02"].map((id) => ({ questionId: id, marks: 1 })),
    maxAttempts: 2,
    showAnswers: true,
    showSubmissionHistory: true,
    passingPercentage: 50,
    totalMarks: 2,
    shuffleQuestions: false,
    limitQuestionsTo: 0,
    durationSeconds: 0,
    enableNegativeMarking: false,
    marksToCut: 0,
    enableScheduling: false,
    enableProctoring: false,
    maxViolations: 3,
    authorId: "usr_priya",
    createdAt: daysAgo(25),
    updatedAt: daysAgo(2),
  },
  {
    id: "quiz_pandas",
    title: "Pandas Essentials",
    courseId: "crs_python",
    lessonId: "les_py_2_2",
    questions: ["qst_py_01", "qst_py_02"].map((id) => ({ questionId: id, marks: 1 })),
    maxAttempts: 0,
    showAnswers: true,
    showSubmissionHistory: true,
    passingPercentage: 50,
    totalMarks: 2,
    shuffleQuestions: false,
    limitQuestionsTo: 0,
    durationSeconds: 0,
    enableNegativeMarking: false,
    marksToCut: 0,
    enableScheduling: false,
    enableProctoring: false,
    maxViolations: 3,
    authorId: "usr_daniel",
    createdAt: daysAgo(25),
    updatedAt: daysAgo(2),
  },
];

const assignments: Assignment[] = [
  {
    id: "asg_js_todo",
    title: "Build a To-Do App",
    question: `Build a small to-do application in vanilla JavaScript.

**Requirements**

- Add, complete and delete tasks
- Persist tasks in \`localStorage\`
- Filter by *All / Active / Completed*

Submit a link to a public repository or a deployed demo.`,
    type: "url",
    showAnswer: false,
    gradeAssignment: true,
    courseId: "crs_js",
    enableScheduling: false,
    authorId: "usr_maya",
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
  },
  {
    id: "asg_design_audit",
    title: "Accessibility Audit",
    question: `Pick any public website and audit one page for accessibility issues.

Write up at least **five** findings. For each one include: the WCAG criterion, a screenshot description, and a proposed fix.`,
    type: "pdf",
    showAnswer: true,
    answer: "A strong audit covers color contrast, focus order, form labels, alt text and heading structure.",
    gradeAssignment: true,
    courseId: "crs_design",
    enableScheduling: false,
    authorId: "usr_priya",
    createdAt: daysAgo(25),
    updatedAt: daysAgo(25),
  },
  {
    id: "asg_react_dashboard",
    title: "Dashboard with Server Components",
    question: `Create a dashboard page in Next.js that fetches data in a Server Component and renders an interactive chart in a Client Component. Explain your component boundaries in a short paragraph.`,
    type: "text",
    showAnswer: false,
    gradeAssignment: true,
    courseId: "crs_react",
    enableScheduling: false,
    authorId: "usr_maya",
    createdAt: daysAgo(20),
    updatedAt: daysAgo(20),
  },
];

const exercises: ProgrammingExercise[] = [
  {
    id: "exr_sum_array",
    title: "Sum of an Array",
    problemStatement: `Write a function \`solve(input)\` that receives a line of space-separated integers as a string and returns their **sum** as a number.

Example: input \`"1 2 3"\` → output \`6\``,
    language: "javascript",
    starterCode: `function solve(input) {\n  // input is a string, e.g. "1 2 3"\n  return 0;\n}\n`,
    testCases: [
      { id: "tc1", input: "1 2 3", expectedOutput: "6" },
      { id: "tc2", input: "10 -4 2", expectedOutput: "8" },
      { id: "tc3", input: "0", expectedOutput: "0", hidden: true },
    ],
    courseId: "crs_js",
    authorId: "usr_maya",
    createdAt: daysAgo(28),
    updatedAt: daysAgo(28),
  },
  {
    id: "exr_palindrome",
    title: "Palindrome Check",
    problemStatement: `Write \`solve(input)\` that returns \`"true"\` if the input string is a palindrome (ignoring case and non-letters), otherwise \`"false"\`.`,
    language: "javascript",
    starterCode: `function solve(input) {\n  return "false";\n}\n`,
    testCases: [
      { id: "tc1", input: "racecar", expectedOutput: "true" },
      { id: "tc2", input: "A man, a plan, a canal: Panama", expectedOutput: "true" },
      { id: "tc3", input: "hello", expectedOutput: "false" },
    ],
    courseId: "crs_js",
    authorId: "usr_maya",
    createdAt: daysAgo(28),
    updatedAt: daysAgo(28),
  },
  {
    id: "exr_fizzbuzz",
    title: "FizzBuzz",
    problemStatement: `Given a number *n* as input, return the FizzBuzz sequence from 1 to *n* separated by spaces.`,
    language: "javascript",
    starterCode: `function solve(input) {\n  const n = Number(input);\n  return "";\n}\n`,
    testCases: [
      { id: "tc1", input: "5", expectedOutput: "1 2 Fizz 4 Buzz" },
      { id: "tc2", input: "15", expectedOutput: "1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz" },
    ],
    courseId: "crs_js",
    authorId: "usr_maya",
    createdAt: daysAgo(28),
    updatedAt: daysAgo(28),
  },
];

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

const categories: Category[] = [
  { id: "cat_web", name: "Web Development", slug: "web-development" },
  { id: "cat_prog", name: "Programming", slug: "programming" },
  { id: "cat_design", name: "Design", slug: "design" },
  { id: "cat_data", name: "Data Science", slug: "data-science" },
  { id: "cat_business", name: "Business", slug: "business" },
];

function course(c: Partial<Course> & Pick<Course, "id" | "slug" | "title" | "shortIntroduction" | "description" | "instructorIds">): Course {
  return {
    cardGradient: "blue",
    tags: [],
    price: 0,
    currency: "USD",
    paidCourse: false,
    paidCertificate: false,
    certificatePrice: 0,
    enableCertification: true,
    published: true,
    publishedOn: daysAgo(30).slice(0, 10),
    upcoming: false,
    featured: false,
    disableSelfLearning: false,
    enforceLessonCompletion: false,
    status: "approved",
    relatedCourseIds: [],
    outcomes: [],
    requirements: [],
    createdById: c.instructorIds[0] ?? "usr_admin",
    createdAt: daysAgo(60),
    updatedAt: daysAgo(3),
    ...c,
  };
}

const courses: Course[] = [
  course({
    id: "crs_js",
    slug: "modern-javascript-fundamentals",
    title: "Modern JavaScript Fundamentals",
    shortIntroduction: "Go from zero to confident with the language that runs the web. Hands-on, project based.",
    description: `## What you'll build

Over three chapters you will write real programs: a number guessing game, a data pipeline with array methods, and a to-do app that persists to \`localStorage\`.

## Who is this for?

Complete beginners and developers coming from other languages who want a fast, modern introduction to JavaScript (ES2023+).

## How the course works

Every lesson pairs a short video with notes, and most chapters end with a quiz or a hands-on exercise. Your progress is saved automatically and you'll earn a certificate when you finish.`,
    imageUrl: VIDEOS.bunny.poster,
    videoUrl: VIDEOS.bullrun.src,
    cardGradient: "amber",
    instructorIds: ["usr_maya"],
    categoryId: "cat_web",
    tags: ["JavaScript", "Beginner", "Web"],
    featured: true,
    outcomes: [
      "Understand variables, types, functions and scope",
      "Work with arrays and objects fluently",
      "Write asynchronous code with promises and async/await",
      "Manipulate the DOM and handle events",
      "Build and ship a small app from scratch",
    ],
    requirements: ["A computer with a modern browser", "No prior programming experience needed"],
    relatedCourseIds: ["crs_react", "crs_ts"],
    publishedOn: daysAgo(55).slice(0, 10),
  }),
  course({
    id: "crs_react",
    slug: "react-nextjs-production-apps",
    title: "React & Next.js: Build Production Apps",
    shortIntroduction: "Server Components, the App Router, data fetching, auth and deployment — the full modern stack.",
    description: `## Ship real applications

This course takes you from a blank folder to a deployed, production-grade application with authentication, a database and a polished UI.

## Curriculum highlights

- The App Router mental model
- Server vs. Client Components
- Server Actions and mutations
- Caching, revalidation and streaming
- Deployment and monitoring`,
    imageUrl: VIDEOS.sintel.poster,
    videoUrl: VIDEOS.fun.src,
    cardGradient: "violet",
    instructorIds: ["usr_maya", "usr_admin"],
    categoryId: "cat_web",
    tags: ["React", "Next.js", "TypeScript"],
    price: 4900,
    paidCourse: true,
    paidCertificate: false,
    featured: true,
    outcomes: ["Architect apps with the App Router", "Fetch and mutate data safely", "Deploy with confidence"],
    requirements: ["Comfortable with JavaScript fundamentals", "Basic HTML & CSS"],
    relatedCourseIds: ["crs_js", "crs_ts"],
    publishedOn: daysAgo(40).slice(0, 10),
  }),
  course({
    id: "crs_design",
    slug: "ui-design-principles-for-developers",
    title: "UI Design Principles for Developers",
    shortIntroduction: "Typography, color, spacing and accessibility — make anything you build look intentional.",
    description: `Developers can design. This course gives you a small set of rules that make interfaces look professional, and teaches you to spot what's wrong when something feels off.

You'll finish with an accessibility audit of a real product and a redesigned component library.`,
    cardGradient: "pink",
    instructorIds: ["usr_priya"],
    categoryId: "cat_design",
    tags: ["Design", "UX", "Accessibility"],
    price: 2900,
    paidCourse: true,
    paidCertificate: true,
    certificatePrice: 1500,
    outcomes: ["Apply the four principles of design", "Pick accessible color palettes", "Build a consistent spacing system"],
    requirements: ["Any web development experience"],
    relatedCourseIds: ["crs_react"],
    publishedOn: daysAgo(35).slice(0, 10),
  }),
  course({
    id: "crs_python",
    slug: "python-for-data-analysis",
    title: "Python for Data Analysis",
    shortIntroduction: "Load, clean, analyze and visualize real datasets with pandas and matplotlib.",
    description: `Learn data analysis the way analysts actually work: messy CSVs, missing values, group-bys, joins and charts that tell a story.

**Lessons unlock in order** — finish each one before moving on.`,
    imageUrl: VIDEOS.tears.poster,
    cardGradient: "teal",
    instructorIds: ["usr_daniel"],
    categoryId: "cat_data",
    tags: ["Python", "Pandas", "Data"],
    enforceLessonCompletion: true,
    outcomes: ["Load and clean data with pandas", "Aggregate and reshape tables", "Produce publication-quality charts"],
    requirements: ["Basic Python syntax"],
    publishedOn: daysAgo(28).slice(0, 10),
  }),
  course({
    id: "crs_ts",
    slug: "advanced-typescript-patterns",
    title: "Advanced TypeScript Patterns",
    shortIntroduction: "Generics, conditional types, branded types and the type-level tricks used by library authors.",
    description: `Coming soon. Enrollment opens when the first chapter is published.`,
    cardGradient: "cyan",
    instructorIds: ["usr_maya"],
    categoryId: "cat_prog",
    tags: ["TypeScript", "Advanced"],
    upcoming: true,
    outcomes: ["Model complex domains with the type system"],
    requirements: ["Solid TypeScript basics"],
    publishedOn: undefined,
  }),
  course({
    id: "crs_startup",
    slug: "startup-fundamentals",
    title: "Startup Fundamentals",
    shortIntroduction: "From idea to first customers: validation, pricing and go-to-market for technical founders.",
    description: `Draft course — awaiting review.`,
    cardGradient: "green",
    instructorIds: ["usr_daniel"],
    categoryId: "cat_business",
    tags: ["Business", "Founders"],
    published: false,
    status: "under_review",
    publishedOn: undefined,
    createdAt: daysAgo(5),
    updatedAt: daysAgo(1),
  }),
];

const jsOutline = buildOutline("crs_js", [
  {
    id: "chp_js_1",
    title: "Getting Started",
    description: "Set up your environment and learn the core syntax.",
    lessons: [
      {
        id: "les_js_1_1",
        slug: "welcome",
        title: "Welcome & Course Overview",
        preview: true,
        blocks: [
          video(VIDEOS.bullrun, "Welcome to the course"),
          md(`## Welcome!

In this course you'll learn JavaScript by **writing** JavaScript. Every chapter ends with something you built yourself.

### How to get the most out of it

1. Watch each video once without pausing.
2. Re-watch while coding along.
3. Do the quiz or exercise *before* moving on.

> Tip: use the **Notes** panel on the right to save timestamped notes while you watch.`),
          callout("info", "All demo accounts use the password `password123`. Try the admin account to see the course editor."),
        ],
        instructorNotes: "Keep the intro under 3 minutes in live cohorts. Point students to the setup lesson if they get stuck installing Node.",
      },
      {
        id: "les_js_1_2",
        slug: "setting-up",
        title: "Setting Up Your Environment",
        preview: true,
        blocks: [
          video(VIDEOS.blazes, "Installing Node.js and VS Code"),
          md(`## Install the tools

- **Node.js** (LTS) from nodejs.org
- **VS Code** with the *ESLint* and *Prettier* extensions

Verify your install:`),
          code("bash", `node --version\nnpm --version`),
          md(`You should see two version numbers. If you do, you're ready.`),
        ],
      },
      {
        id: "les_js_1_3",
        slug: "variables-and-types",
        title: "Variables, Types and Operators",
        blocks: [
          video(VIDEOS.bunny, "Variables, types and operators", {
            chapters: [
              { time: 0, title: "Intro" },
              { time: 60, title: "let vs const" },
              { time: 180, title: "Primitive types" },
              { time: 320, title: "Operators" },
              { time: 480, title: "Type coercion" },
            ],
            quizMarkers: [{ time: 120, quizId: "quiz_js_basics" }],
          }),
          md(`## Key points

| Keyword | Reassignable | Scope |
| --- | --- | --- |
| \`var\` | yes | function |
| \`let\` | yes | block |
| \`const\` | no | block |

Use \`const\` by default and \`let\` only when you must reassign.`),
          code("javascript", `const name = "Ada";\nlet age = 36;\nage += 1;\n\nconsole.log(typeof name, typeof age); // "string" "number"`),
        ],
      },
      {
        id: "les_js_1_4",
        slug: "basics-quiz",
        title: "Quiz: JavaScript Basics",
        blocks: [md(`Check your understanding of the first chapter. You need **70%** to pass and you have up to 3 attempts.`), quizBlock("quiz_js_basics")],
      },
    ],
  },
  {
    id: "chp_js_2",
    title: "Working with Data",
    description: "Arrays, objects and the methods you'll use every day.",
    lessons: [
      {
        id: "les_js_2_1",
        slug: "arrays",
        title: "Arrays and Array Methods",
        blocks: [
          video(VIDEOS.elephants, "map, filter, reduce and friends", {
            chapters: [
              { time: 0, title: "Creating arrays" },
              { time: 140, title: "map" },
              { time: 300, title: "filter" },
              { time: 430, title: "reduce" },
              { time: 560, title: "Chaining" },
            ],
          }),
          md(`## The big three

- \`map\` — transform every element
- \`filter\` — keep some elements
- \`reduce\` — fold everything into one value`),
          code("javascript", `const prices = [12, 40, 7];\nconst total = prices\n  .filter((p) => p > 10)\n  .map((p) => p * 1.2)\n  .reduce((sum, p) => sum + p, 0);`),
        ],
      },
      {
        id: "les_js_2_2",
        slug: "objects",
        title: "Objects, Destructuring and Spread",
        blocks: [
          video(VIDEOS.escapes, "Objects in depth"),
          md(`Objects are bags of key/value pairs. Destructuring pulls values out, spread copies them in.`),
          code("javascript", `const user = { name: "Ada", role: "admin" };\nconst { name, ...rest } = user;\nconst updated = { ...user, role: "owner" };`),
        ],
      },
      {
        id: "les_js_2_3",
        slug: "exercise-sum",
        title: "Exercise: Sum of an Array",
        blocks: [
          md(`Time to write code. Implement the function below and run the test cases. All tests must pass to complete the lesson.`),
          exerciseBlock("exr_sum_array"),
          exerciseBlock("exr_palindrome"),
        ],
      },
    ],
  },
  {
    id: "chp_js_3",
    title: "Async JavaScript & The DOM",
    lessons: [
      {
        id: "les_js_3_1",
        slug: "promises-async-await",
        title: "Promises and async/await",
        blocks: [
          video(VIDEOS.sintel, "Asynchronous JavaScript", {
            chapters: [
              { time: 0, title: "Callbacks" },
              { time: 200, title: "Promises" },
              { time: 450, title: "async/await" },
              { time: 700, title: "Error handling" },
            ],
          }),
          md(`## async/await`),
          code("javascript", `async function load() {\n  try {\n    const res = await fetch("/api/courses");\n    return await res.json();\n  } catch (err) {\n    console.error(err);\n  }\n}`),
        ],
      },
      {
        id: "les_js_3_2",
        slug: "dom-and-events",
        title: "The DOM and Events",
        blocks: [
          video(VIDEOS.joyrides, "Selecting elements and handling events"),
          md(`Use \`querySelector\` to find elements and \`addEventListener\` to react to the user.`),
          callout("warning", "Never build HTML strings from user input — use `textContent` to avoid XSS."),
        ],
      },
      {
        id: "les_js_3_3",
        slug: "final-project",
        title: "Final Project & Exam",
        blocks: [
          md(`## Final project

Build the to-do app described in the assignment below, then take the final exam. The exam is **proctored**: switching tabs more than 3 times will submit it automatically.`),
          assignmentBlock("asg_js_todo"),
          quizBlock("quiz_js_final"),
        ],
      },
    ],
  },
]);

const reactOutline = buildOutline("crs_react", [
  {
    id: "chp_react_1",
    title: "The App Router",
    lessons: [
      {
        id: "les_react_1_1",
        slug: "course-intro",
        title: "Course Introduction",
        preview: true,
        blocks: [video(VIDEOS.fun, "What we'll build"), md(`We'll build **Loop**, a project tracker, from scratch and deploy it.`)],
      },
      {
        id: "les_react_1_2",
        slug: "routing-layouts",
        title: "Routing, Layouts and Pages",
        blocks: [
          video(VIDEOS.tears, "Files that become routes", {
            chapters: [
              { time: 0, title: "app/ directory" },
              { time: 180, title: "layout.tsx" },
              { time: 360, title: "Dynamic segments" },
              { time: 540, title: "Route groups" },
            ],
          }),
          md(`Every folder is a route segment. \`page.tsx\` makes it public, \`layout.tsx\` wraps its children.`),
        ],
      },
      {
        id: "les_react_1_3",
        slug: "server-client-components",
        title: "Server vs Client Components",
        blocks: [
          video(VIDEOS.grand, "Where does the code run?"),
          md(`Server Components run only on the server: no bundle cost, direct data access. Add \`"use client"\` when you need state, effects or browser APIs.`),
          quizBlock("quiz_react_app_router"),
        ],
      },
    ],
  },
  {
    id: "chp_react_2",
    title: "Data and Mutations",
    lessons: [
      {
        id: "les_react_2_1",
        slug: "fetching-data",
        title: "Fetching Data",
        blocks: [video(VIDEOS.gti, "Async components and caching"), md(`Fetch in Server Components with plain \`await\`.`)],
      },
      {
        id: "les_react_2_2",
        slug: "server-actions",
        title: "Server Actions",
        blocks: [
          video(VIDEOS.subaru, "Mutating data without API routes"),
          code("tsx", `"use server";\n\nexport async function createTask(formData: FormData) {\n  await db.tasks.insert({ title: formData.get("title") });\n  revalidatePath("/tasks");\n}`),
          assignmentBlock("asg_react_dashboard"),
        ],
      },
    ],
  },
  {
    id: "chp_react_3",
    title: "Shipping",
    lessons: [
      {
        id: "les_react_3_1",
        slug: "auth",
        title: "Authentication",
        blocks: [video(VIDEOS.meltdowns, "Sessions and cookies"), md(`Use httpOnly cookies and check the session in every Server Action.`)],
      },
      {
        id: "les_react_3_2",
        slug: "deploy",
        title: "Deployment & Monitoring",
        blocks: [video(VIDEOS.blazes, "Going live"), md(`Build, set environment variables, deploy. Then watch your logs for a day.`)],
      },
    ],
  },
]);

const designOutline = buildOutline("crs_design", [
  {
    id: "chp_design_1",
    title: "Foundations",
    lessons: [
      {
        id: "les_design_1_1",
        slug: "why-design",
        title: "Why Developers Should Learn Design",
        preview: true,
        blocks: [video(VIDEOS.joyrides, "Design is a skill, not a talent"), md(`Good design is mostly **consistency**. You can learn consistency.`)],
      },
      {
        id: "les_design_1_2",
        slug: "the-four-principles",
        title: "Contrast, Repetition, Alignment, Proximity",
        blocks: [
          video(VIDEOS.elephants, "The C.R.A.P. principles", {
            chapters: [
              { time: 0, title: "Contrast" },
              { time: 160, title: "Repetition" },
              { time: 330, title: "Alignment" },
              { time: 500, title: "Proximity" },
            ],
          }),
          md(`Every visual decision can be justified by one of these four principles.`),
        ],
      },
      { id: "les_design_1_3", slug: "principles-quiz", title: "Quiz: Principles", blocks: [quizBlock("quiz_design_basics")] },
    ],
  },
  {
    id: "chp_design_2",
    title: "Color, Type and Space",
    lessons: [
      {
        id: "les_design_2_1",
        slug: "color-and-contrast",
        title: "Color and Accessible Contrast",
        blocks: [video(VIDEOS.bunny, "Building a palette"), md(`Aim for **4.5:1** contrast on body text. Pick one accent color and use neutrals for everything else.`)],
      },
      {
        id: "les_design_2_2",
        slug: "accessibility-audit",
        title: "Assignment: Accessibility Audit",
        blocks: [md(`Apply what you learned to a real product.`), assignmentBlock("asg_design_audit")],
      },
    ],
  },
]);

const pythonOutline = buildOutline("crs_python", [
  {
    id: "chp_py_1",
    title: "Pandas Basics",
    lessons: [
      {
        id: "les_py_1_1",
        slug: "loading-data",
        title: "Loading Data",
        preview: true,
        blocks: [video(VIDEOS.tears, "Reading CSV and Excel files"), code("python", `import pandas as pd\n\ndf = pd.read_csv("sales.csv")\ndf.head()`)],
      },
      {
        id: "les_py_1_2",
        slug: "cleaning-data",
        title: "Cleaning Messy Data",
        blocks: [video(VIDEOS.sintel, "Missing values, types and duplicates"), md(`Real data is dirty. Start every analysis with \`df.info()\` and \`df.isna().sum()\`.`)],
      },
    ],
  },
  {
    id: "chp_py_2",
    title: "Analysis",
    lessons: [
      {
        id: "les_py_2_1",
        slug: "grouping-and-aggregation",
        title: "Grouping and Aggregation",
        blocks: [video(VIDEOS.elephants, "groupby in depth"), code("python", `df.groupby("city")["revenue"].agg(["sum", "mean"])`)],
      },
      { id: "les_py_2_2", slug: "pandas-quiz", title: "Quiz: Pandas Essentials", blocks: [quizBlock("quiz_pandas")] },
      {
        id: "les_py_2_3",
        slug: "charts",
        title: "Charts That Tell a Story",
        blocks: [video(VIDEOS.bunny, "matplotlib essentials"), md(`One chart, one message. Label your axes.`)],
      },
    ],
  },
]);

const chapters: Chapter[] = [...jsOutline.chapters, ...reactOutline.chapters, ...designOutline.chapters, ...pythonOutline.chapters];
const lessons: Lesson[] = [...jsOutline.lessons, ...reactOutline.lessons, ...designOutline.lessons, ...pythonOutline.lessons];

/* ------------------------------------------------------------------ */
/* Enrollments, progress, watches, submissions                         */
/* ------------------------------------------------------------------ */

const enrollments: Enrollment[] = [
  { id: "enr_alex_js", userId: "usr_alex", courseId: "crs_js", memberType: "student", enrolledAt: daysAgo(30), progress: 40, currentLessonId: "les_js_2_1", purchasedCertificate: false },
  { id: "enr_alex_react", userId: "usr_alex", courseId: "crs_react", memberType: "student", enrolledAt: daysAgo(12), progress: 14, currentLessonId: "les_react_1_2", purchasedCertificate: false, paymentId: "pay_alex_react" },
  { id: "enr_alex_py", userId: "usr_alex", courseId: "crs_python", memberType: "student", enrolledAt: daysAgo(5), progress: 0, purchasedCertificate: false },
  { id: "enr_sofia_js", userId: "usr_sofia", courseId: "crs_js", memberType: "student", enrolledAt: daysAgo(70), completedAt: daysAgo(20), progress: 100, currentLessonId: "les_js_3_3", purchasedCertificate: false, certificateId: "cert_sofia_js" },
  { id: "enr_sofia_design", userId: "usr_sofia", courseId: "crs_design", memberType: "student", enrolledAt: daysAgo(18), progress: 60, currentLessonId: "les_design_2_1", purchasedCertificate: false, paymentId: "pay_sofia_design" },
  { id: "enr_liam_js", userId: "usr_liam", courseId: "crs_js", memberType: "student", enrolledAt: daysAgo(15), progress: 10, currentLessonId: "les_js_1_2", purchasedCertificate: false },
  { id: "enr_emma_js", userId: "usr_emma", courseId: "crs_js", memberType: "student", enrolledAt: daysAgo(3), progress: 0, purchasedCertificate: false },
  { id: "enr_emma_py", userId: "usr_emma", courseId: "crs_python", memberType: "student", enrolledAt: daysAgo(2), progress: 0, purchasedCertificate: false },
  { id: "enr_maya_js", userId: "usr_maya", courseId: "crs_js", memberType: "staff", enrolledAt: daysAgo(60), progress: 0, purchasedCertificate: false },
];

function prog(userId: string, courseId: string, chapterId: string, lessonId: string, status: "complete" | "partial", ago: number): LessonProgress {
  return {
    id: `prg_${userId.slice(4)}_${lessonId.slice(4)}`,
    userId,
    courseId,
    chapterId,
    lessonId,
    status,
    dwellSeconds: status === "complete" ? 600 : 120,
    completedAt: status === "complete" ? daysAgo(ago) : undefined,
    updatedAt: daysAgo(ago),
  };
}

const progress: LessonProgress[] = [
  prog("usr_alex", "crs_js", "chp_js_1", "les_js_1_1", "complete", 29),
  prog("usr_alex", "crs_js", "chp_js_1", "les_js_1_2", "complete", 28),
  prog("usr_alex", "crs_js", "chp_js_1", "les_js_1_3", "complete", 25),
  prog("usr_alex", "crs_js", "chp_js_1", "les_js_1_4", "complete", 24),
  prog("usr_alex", "crs_js", "chp_js_2", "les_js_2_1", "partial", 2),
  prog("usr_alex", "crs_react", "chp_react_1", "les_react_1_1", "complete", 11),
  prog("usr_alex", "crs_react", "chp_react_1", "les_react_1_2", "partial", 1),
  ...jsOutline.lessons.map((l) => prog("usr_sofia", "crs_js", l.chapterId, l.id, "complete", 20)),
  prog("usr_sofia", "crs_design", "chp_design_1", "les_design_1_1", "complete", 17),
  prog("usr_sofia", "crs_design", "chp_design_1", "les_design_1_2", "complete", 16),
  prog("usr_sofia", "crs_design", "chp_design_1", "les_design_1_3", "complete", 15),
  prog("usr_liam", "crs_js", "chp_js_1", "les_js_1_1", "complete", 14),
];

const videoWatches: VideoWatch[] = [
  {
    id: "vw_alex_js_2_1",
    userId: "usr_alex",
    courseId: "crs_js",
    lessonId: "les_js_2_1",
    blockId: jsOutline.lessons.find((l) => l.id === "les_js_2_1")!.blocks[0]!.id,
    source: VIDEOS.elephants.src,
    watchSeconds: 210,
    lastPositionSeconds: 215,
    maxPositionSeconds: 215,
    durationSeconds: VIDEOS.elephants.duration,
    completed: false,
    updatedAt: daysAgo(2),
  },
  {
    id: "vw_alex_js_1_3",
    userId: "usr_alex",
    courseId: "crs_js",
    lessonId: "les_js_1_3",
    blockId: jsOutline.lessons.find((l) => l.id === "les_js_1_3")!.blocks[0]!.id,
    source: VIDEOS.bunny.src,
    watchSeconds: 590,
    lastPositionSeconds: 596,
    maxPositionSeconds: 596,
    durationSeconds: VIDEOS.bunny.duration,
    completed: true,
    updatedAt: daysAgo(25),
  },
];

const quizSubmissions: QuizSubmission[] = [
  {
    id: "qsub_alex_basics_1",
    quizId: "quiz_js_basics",
    quizTitle: "JavaScript Basics Check",
    userId: "usr_alex",
    courseId: "crs_js",
    lessonId: "les_js_1_4",
    results: [
      { questionId: "qst_js_01", questionText: questions[0]!.text, questionType: "choices", answer: ["qst_js_01_o3"], isCorrect: true, marks: 1, marksOutOf: 1, graded: true },
      { questionId: "qst_js_02", questionText: questions[1]!.text, questionType: "choices", answer: ["qst_js_02_o1"], isCorrect: false, marks: 0, marksOutOf: 1, graded: true },
      { questionId: "qst_js_03", questionText: questions[2]!.text, questionType: "choices", answer: ["qst_js_03_o1", "qst_js_03_o2", "qst_js_03_o4"], isCorrect: true, marks: 1, marksOutOf: 1, graded: true },
      { questionId: "qst_js_04", questionText: questions[3]!.text, questionType: "choices", answer: ["qst_js_04_o2"], isCorrect: true, marks: 1, marksOutOf: 1, graded: true },
      { questionId: "qst_js_05", questionText: questions[4]!.text, questionType: "choices", answer: ["qst_js_05_o1"], isCorrect: true, marks: 1, marksOutOf: 1, graded: true },
      { questionId: "qst_js_06", questionText: questions[5]!.text, questionType: "choices", answer: ["qst_js_06_o2"], isCorrect: true, marks: 1, marksOutOf: 1, graded: true },
      { questionId: "qst_js_07", questionText: questions[6]!.text, questionType: "user_input", answer: ["==="], isCorrect: true, marks: 1, marksOutOf: 1, graded: true },
    ],
    score: 6,
    scoreOutOf: 7,
    percentage: 86,
    passingPercentage: 70,
    passed: true,
    violationCount: 0,
    timeTakenSeconds: 312,
    pendingGrading: false,
    submittedAt: daysAgo(24),
  },
  {
    id: "qsub_sofia_final",
    quizId: "quiz_js_final",
    quizTitle: "JavaScript Final Exam",
    userId: "usr_sofia",
    courseId: "crs_js",
    lessonId: "les_js_3_3",
    results: [
      ...["qst_js_01", "qst_js_02", "qst_js_03", "qst_js_04", "qst_js_05", "qst_js_06"].map((id, i) => ({
        questionId: id,
        questionText: questions[i]!.text,
        questionType: "choices" as const,
        answer: questions[i]!.options.filter((o) => o.isCorrect).map((o) => o.id),
        isCorrect: true,
        marks: 1,
        marksOutOf: 1,
        graded: true,
      })),
      { questionId: "qst_js_07", questionText: questions[6]!.text, questionType: "user_input", answer: ["==="], isCorrect: true, marks: 1, marksOutOf: 1, graded: true },
      { questionId: "qst_js_08", questionText: questions[7]!.text, questionType: "open_ended", answer: ["`==` coerces types before comparing; `===` compares type and value without coercion."], isCorrect: true, marks: 2, marksOutOf: 2, graded: true },
    ],
    score: 9,
    scoreOutOf: 9,
    percentage: 100,
    passingPercentage: 75,
    passed: true,
    violationCount: 1,
    timeTakenSeconds: 640,
    pendingGrading: false,
    submittedAt: daysAgo(21),
  },
];

const assignmentSubmissions: AssignmentSubmission[] = [
  {
    id: "asub_sofia_todo",
    assignmentId: "asg_js_todo",
    assignmentTitle: "Build a To-Do App",
    userId: "usr_sofia",
    courseId: "crs_js",
    lessonId: "les_js_3_3",
    type: "url",
    answer: "https://github.com/example/todo-app",
    status: "pass",
    comments: "Clean code and the filters work perfectly. Consider adding keyboard shortcuts next time.",
    evaluatorId: "usr_maya",
    gradedAt: daysAgo(20),
    submittedAt: daysAgo(22),
    updatedAt: daysAgo(20),
  },
  {
    id: "asub_alex_todo",
    assignmentId: "asg_js_todo",
    assignmentTitle: "Build a To-Do App",
    userId: "usr_alex",
    courseId: "crs_js",
    lessonId: "les_js_3_3",
    type: "url",
    answer: "https://github.com/example/alex-todo",
    status: "not_graded",
    submittedAt: daysAgo(1),
    updatedAt: daysAgo(1),
  },
];

const exerciseSubmissions: ExerciseSubmission[] = [
  {
    id: "esub_sofia_sum",
    exerciseId: "exr_sum_array",
    exerciseTitle: "Sum of an Array",
    userId: "usr_sofia",
    courseId: "crs_js",
    lessonId: "les_js_2_3",
    code: `function solve(input) {\n  return input.split(" ").map(Number).reduce((a, b) => a + b, 0);\n}`,
    status: "passed",
    testResults: [
      { testCaseId: "tc1", input: "1 2 3", expectedOutput: "6", actualOutput: "6", passed: true },
      { testCaseId: "tc2", input: "10 -4 2", expectedOutput: "8", actualOutput: "8", passed: true },
      { testCaseId: "tc3", input: "0", expectedOutput: "0", actualOutput: "0", passed: true },
    ],
    submittedAt: daysAgo(23),
  },
];

const notes: LessonNote[] = [
  {
    id: "note_alex_1",
    userId: "usr_alex",
    courseId: "crs_js",
    lessonId: "les_js_1_3",
    color: "yellow",
    timestampSeconds: 185,
    note: "Primitive types: string, number, boolean, null, undefined, symbol, bigint.",
    createdAt: daysAgo(25),
    updatedAt: daysAgo(25),
  },
  {
    id: "note_alex_2",
    userId: "usr_alex",
    courseId: "crs_js",
    lessonId: "les_js_1_3",
    color: "green",
    highlightedText: "Use const by default",
    note: "Ask Maya why not always let?",
    createdAt: daysAgo(24),
    updatedAt: daysAgo(24),
  },
];

const reviews: Review[] = [
  { id: "rev_1", userId: "usr_sofia", courseId: "crs_js", rating: 5, review: "The best beginner course I've taken. The exercises with instant feedback made everything click.", createdAt: daysAgo(19) },
  { id: "rev_2", userId: "usr_alex", courseId: "crs_js", rating: 4, review: "Great pacing. Would love more DOM practice.", createdAt: daysAgo(10) },
  { id: "rev_3", userId: "usr_liam", courseId: "crs_js", rating: 5, review: "Clear and practical.", createdAt: daysAgo(8) },
  { id: "rev_4", userId: "usr_sofia", courseId: "crs_design", rating: 4, review: "Priya's critiques are gold.", createdAt: daysAgo(9) },
  { id: "rev_5", userId: "usr_alex", courseId: "crs_react", rating: 5, review: "Finally understand Server Components.", createdAt: daysAgo(4) },
];

/* ------------------------------------------------------------------ */
/* Batches, live classes, programs                                     */
/* ------------------------------------------------------------------ */

const batches: Batch[] = [
  {
    id: "bat_js_cohort4",
    slug: "javascript-bootcamp-cohort-4",
    title: "JavaScript Bootcamp — Cohort 4",
    description: "Four weeks, live classes twice a week, a mentor and a graded final project.",
    details: `## What's included

- **8 live classes** with Maya (recorded for later)
- Weekly office hours
- Code reviews on every assignment
- A certificate after passing the final evaluation

## Schedule

Tuesdays and Thursdays, 6–7:30 PM (your local time is shown on the batch page).`,
    imageUrl: VIDEOS.bunny.poster,
    categoryId: "cat_web",
    startDate: dateKeyIn(10),
    endDate: dateKeyIn(38),
    startTime: "18:00",
    endTime: "19:30",
    timezone: "America/New_York",
    medium: "online",
    seatCount: 25,
    paidBatch: true,
    amount: 19900,
    currency: "USD",
    published: true,
    allowSelfEnrollment: true,
    allowFuture: true,
    showLiveClass: true,
    certification: true,
    evaluationEndDate: dateKeyIn(45),
    instructorIds: ["usr_maya"],
    courseIds: ["crs_js"],
    assessments: [
      { id: "bas_1", type: "quiz", refId: "quiz_js_final" },
      { id: "bas_2", type: "assignment", refId: "asg_js_todo" },
      { id: "bas_3", type: "exercise", refId: "exr_fizzbuzz" },
    ],
    timetable: [
      { id: "tt_1", type: "live_class", refId: "lc_js4_kickoff", title: "Kickoff & Setup", date: dateKeyIn(10), startTime: "18:00", endTime: "19:30", milestone: true, legendId: "lg_live" },
      { id: "tt_2", type: "lesson", refId: "les_js_1_3", title: "Variables & Types", date: dateKeyIn(12), startTime: "18:00", endTime: "19:30", milestone: false, legendId: "lg_lesson" },
      { id: "tt_3", type: "quiz", refId: "quiz_js_basics", title: "Basics quiz due", date: dateKeyIn(14), milestone: false, legendId: "lg_assess" },
      { id: "tt_4", type: "live_class", refId: "lc_js4_arrays", title: "Arrays workshop", date: dateKeyIn(17), startTime: "18:00", endTime: "19:30", milestone: false, legendId: "lg_live" },
      { id: "tt_5", type: "assignment", refId: "asg_js_todo", title: "To-Do app due", date: dateKeyIn(31), milestone: true, legendId: "lg_assess" },
      { id: "tt_6", type: "custom", title: "Demo day 🎉", date: dateKeyIn(38), startTime: "18:00", endTime: "20:00", milestone: true, legendId: "lg_live" },
    ],
    timetableLegends: [
      { id: "lg_live", label: "Live class", color: "#4f46e5" },
      { id: "lg_lesson", label: "Self-paced lesson", color: "#0891b2" },
      { id: "lg_assess", label: "Assessment", color: "#d97706" },
    ],
    conferencingProvider: "custom",
    createdById: "usr_maya",
    createdAt: daysAgo(20),
    updatedAt: daysAgo(2),
  },
  {
    id: "bat_react_weekend",
    slug: "react-weekend-cohort",
    title: "React Weekend Cohort",
    description: "A running cohort for working professionals. Saturday sessions, async support all week.",
    details: `Live now. Sessions are on Saturdays at 10 AM; recordings appear in the batch within an hour.`,
    categoryId: "cat_web",
    startDate: dateKeyIn(-14),
    endDate: dateKeyIn(28),
    startTime: "10:00",
    endTime: "13:00",
    timezone: "Europe/London",
    medium: "online",
    seatCount: 0,
    paidBatch: false,
    amount: 0,
    currency: "USD",
    published: true,
    allowSelfEnrollment: true,
    allowFuture: true,
    showLiveClass: true,
    certification: false,
    instructorIds: ["usr_maya", "usr_admin"],
    courseIds: ["crs_react", "crs_design"],
    assessments: [{ id: "bas_4", type: "assignment", refId: "asg_react_dashboard" }],
    timetable: [
      { id: "tt_7", type: "live_class", refId: "lc_react_1", title: "App Router deep dive", date: dateKeyIn(-7), startTime: "10:00", endTime: "13:00", milestone: false },
      { id: "tt_8", type: "live_class", refId: "lc_react_2", title: "Data fetching patterns", date: dateKeyIn(0), startTime: "10:00", endTime: "13:00", milestone: false },
      { id: "tt_9", type: "live_class", refId: "lc_react_3", title: "Server Actions workshop", date: dateKeyIn(7), startTime: "10:00", endTime: "13:00", milestone: false },
    ],
    timetableLegends: [],
    conferencingProvider: "custom",
    createdById: "usr_maya",
    createdAt: daysAgo(30),
    updatedAt: daysAgo(1),
  },
  {
    id: "bat_design_private",
    slug: "design-critique-circle",
    title: "Design Critique Circle (invite only)",
    description: "A private critique group for alumni.",
    details: "Invite only.",
    startDate: dateKeyIn(3),
    endDate: dateKeyIn(60),
    startTime: "17:00",
    endTime: "18:00",
    timezone: "Asia/Kolkata",
    medium: "online",
    seatCount: 10,
    paidBatch: false,
    amount: 0,
    currency: "USD",
    published: false,
    allowSelfEnrollment: false,
    allowFuture: false,
    showLiveClass: true,
    certification: false,
    instructorIds: ["usr_priya"],
    courseIds: ["crs_design"],
    assessments: [],
    timetable: [],
    timetableLegends: [],
    createdById: "usr_priya",
    createdAt: daysAgo(4),
    updatedAt: daysAgo(4),
  },
];

const batchEnrollments: BatchEnrollment[] = [
  { id: "ben_1", batchId: "bat_js_cohort4", userId: "usr_alex", paymentId: "pay_alex_batch", source: "Website", confirmationEmailSent: true, enrolledAt: daysAgo(6) },
  { id: "ben_2", batchId: "bat_js_cohort4", userId: "usr_emma", source: "Referral", confirmationEmailSent: true, enrolledAt: daysAgo(2) },
  { id: "ben_3", batchId: "bat_react_weekend", userId: "usr_alex", source: "Website", confirmationEmailSent: true, enrolledAt: daysAgo(13) },
  { id: "ben_4", batchId: "bat_react_weekend", userId: "usr_sofia", source: "Website", confirmationEmailSent: true, enrolledAt: daysAgo(12) },
  { id: "ben_5", batchId: "bat_react_weekend", userId: "usr_liam", source: "Newsletter", confirmationEmailSent: false, enrolledAt: daysAgo(9) },
];

const liveClasses: LiveClass[] = [
  { id: "lc_js4_kickoff", batchId: "bat_js_cohort4", title: "Kickoff & Setup", description: "Meet the cohort, set up your environment, and get your first program running.", date: dateKeyIn(10), time: "18:00", durationMinutes: 90, timezone: "America/New_York", hostId: "usr_maya", provider: "custom", joinUrl: "https://meet.example.com/js4-kickoff", autoRecording: "cloud", attendeeIds: [], createdAt: daysAgo(10) },
  { id: "lc_js4_arrays", batchId: "bat_js_cohort4", title: "Arrays Workshop", description: "Live coding: map/filter/reduce challenges.", date: dateKeyIn(17), time: "18:00", durationMinutes: 90, timezone: "America/New_York", hostId: "usr_maya", provider: "custom", joinUrl: "https://meet.example.com/js4-arrays", autoRecording: "cloud", attendeeIds: [], createdAt: daysAgo(10) },
  { id: "lc_react_1", batchId: "bat_react_weekend", title: "App Router Deep Dive", date: dateKeyIn(-7), time: "10:00", durationMinutes: 180, timezone: "Europe/London", hostId: "usr_maya", provider: "custom", joinUrl: "https://meet.example.com/react-1", autoRecording: "cloud", recordingUrl: VIDEOS.tears.src, attendeeIds: ["usr_alex", "usr_sofia"], createdAt: daysAgo(14) },
  { id: "lc_react_2", batchId: "bat_react_weekend", title: "Data Fetching Patterns", date: dateKeyIn(0), time: "10:00", durationMinutes: 180, timezone: "Europe/London", hostId: "usr_maya", provider: "custom", joinUrl: "https://meet.example.com/react-2", autoRecording: "cloud", attendeeIds: [], createdAt: daysAgo(14) },
  { id: "lc_react_3", batchId: "bat_react_weekend", title: "Server Actions Workshop", date: dateKeyIn(7), time: "10:00", durationMinutes: 180, timezone: "Europe/London", hostId: "usr_admin", provider: "custom", joinUrl: "https://meet.example.com/react-3", autoRecording: "none", attendeeIds: [], createdAt: daysAgo(14) },
];

const announcements: Announcement[] = [
  { id: "ann_1", batchId: "bat_react_weekend", authorId: "usr_maya", subject: "Recording of Saturday's session is up", body: "The recording for **App Router Deep Dive** is now available under Live Classes. Homework: finish chapter 1 before next week.", createdAt: daysAgo(6) },
  { id: "ann_2", batchId: "bat_js_cohort4", authorId: "usr_maya", subject: "Welcome to Cohort 4!", body: "We start in ten days. Please complete the *Setting Up Your Environment* lesson before the kickoff.", createdAt: daysAgo(3) },
  { id: "ann_3", courseId: "crs_js", authorId: "usr_maya", subject: "New exercise added", body: "Chapter 2 now has a second exercise (Palindrome Check). Give it a go!", createdAt: daysAgo(7) },
];

const emailTemplates: EmailTemplate[] = [
  {
    id: "tpl_batch_confirm",
    name: "Batch confirmation",
    subject: "You're in: {{ batch_title }}",
    body: `Hi {{ member_name }},\n\nYour seat in **{{ batch_title }}** is confirmed. The batch starts on {{ start_date }} at {{ start_time }} ({{ timezone }}).\n\nSee you there!`,
    batchId: "bat_js_cohort4",
    createdAt: daysAgo(15),
    updatedAt: daysAgo(15),
  },
];

const programs: Program[] = [
  {
    id: "prg_fullstack",
    slug: "full-stack-developer-path",
    title: "Full-Stack Developer Path",
    description: "Three courses that take you from JavaScript basics to shipping production React apps that look great.",
    published: true,
    enforceCourseOrder: true,
    courseIds: ["crs_js", "crs_react", "crs_design"],
    createdById: "usr_maya",
    createdAt: daysAgo(25),
    updatedAt: daysAgo(5),
  },
];

const programMembers: ProgramMember[] = [
  { id: "pm_1", programId: "prg_fullstack", userId: "usr_alex", progress: 18, joinedAt: daysAgo(12) },
  { id: "pm_2", programId: "prg_fullstack", userId: "usr_sofia", progress: 53, joinedAt: daysAgo(18) },
];

/* ------------------------------------------------------------------ */
/* Certificates, badges, activity, notifications                       */
/* ------------------------------------------------------------------ */

const certificates: Certificate[] = [
  { id: "cert_sofia_js", code: "LL-7K2M-Q9ZX", userId: "usr_sofia", courseId: "crs_js", issueDate: daysAgo(20).slice(0, 10), published: true },
];

const evaluatorSlots: EvaluatorSlot[] = [
  { id: "slot_1", evaluatorId: "usr_priya", day: 1, startTime: "10:00", endTime: "12:00" },
  { id: "slot_2", evaluatorId: "usr_priya", day: 3, startTime: "15:00", endTime: "17:00" },
  { id: "slot_3", evaluatorId: "usr_admin", day: 5, startTime: "09:00", endTime: "11:00" },
];

const badges: Badge[] = [
  { id: "bdg_first_steps", title: "First Steps", description: "Enrolled in your first course.", imageUrl: "/images/badges/first-steps.svg", event: "course_enrolled", threshold: 1, grantOnlyOnce: true, enabled: true, createdAt: daysAgo(90) },
  { id: "bdg_finisher", title: "Finisher", description: "Completed a course from start to end.", imageUrl: "/images/badges/finisher.svg", event: "course_completed", threshold: 1, grantOnlyOnce: true, enabled: true, createdAt: daysAgo(90) },
  { id: "bdg_quiz_whiz", title: "Quiz Whiz", description: "Passed a quiz with 100%.", imageUrl: "/images/badges/quiz-whiz.svg", event: "quiz_passed", threshold: 100, grantOnlyOnce: true, enabled: true, createdAt: daysAgo(90) },
  { id: "bdg_streak_7", title: "On a Roll", description: "Learned 7 days in a row.", imageUrl: "/images/badges/streak-7.svg", event: "streak_7", grantOnlyOnce: true, enabled: true, createdAt: daysAgo(90) },
  { id: "bdg_certified", title: "Certified", description: "Earned a certificate.", imageUrl: "/images/badges/certified.svg", event: "certificate_issued", grantOnlyOnce: true, enabled: true, createdAt: daysAgo(90) },
];

const badgeAssignments: BadgeAssignment[] = [
  { id: "ba_1", badgeId: "bdg_first_steps", userId: "usr_alex", issuedOn: daysAgo(30).slice(0, 10) },
  { id: "ba_2", badgeId: "bdg_first_steps", userId: "usr_sofia", issuedOn: daysAgo(70).slice(0, 10) },
  { id: "ba_3", badgeId: "bdg_finisher", userId: "usr_sofia", issuedOn: daysAgo(20).slice(0, 10) },
  { id: "ba_4", badgeId: "bdg_quiz_whiz", userId: "usr_sofia", issuedOn: daysAgo(21).slice(0, 10) },
  { id: "ba_5", badgeId: "bdg_certified", userId: "usr_sofia", issuedOn: daysAgo(20).slice(0, 10) },
  { id: "ba_6", badgeId: "bdg_first_steps", userId: "usr_liam", issuedOn: daysAgo(15).slice(0, 10) },
];

const activities: Activity[] = [];
// Alex has a 5-day streak ending today, plus scattered activity before.
for (const d of [0, 1, 2, 3, 4, 7, 8, 10, 13, 14, 18, 24, 25, 28, 29]) {
  activities.push({ id: `act_alex_${d}`, userId: "usr_alex", date: dateKeyIn(-d), type: d % 3 === 0 ? "lesson_view" : "lesson_complete", createdAt: daysAgo(d) });
}
for (const d of [20, 21, 22, 23, 24, 25, 26, 27, 40, 41, 60, 70]) {
  activities.push({ id: `act_sofia_${d}`, userId: "usr_sofia", date: dateKeyIn(-d), type: "lesson_complete", createdAt: daysAgo(d) });
}
for (const d of [0, 1, 3, 14]) {
  activities.push({ id: `act_liam_${d}`, userId: "usr_liam", date: dateKeyIn(-d), type: "lesson_view", createdAt: daysAgo(d) });
}

const notifications: Notification[] = [
  { id: "ntf_1", userId: "usr_alex", fromUserId: "usr_maya", type: "announcement", subject: "Welcome to Cohort 4!", message: "We start in ten days.", link: "/batches/javascript-bootcamp-cohort-4", read: false, createdAt: daysAgo(3) },
  { id: "ntf_2", userId: "usr_alex", type: "live_class", subject: "Live class today: Data Fetching Patterns", message: "Starts at 10:00 (Europe/London).", link: "/batches/react-weekend-cohort", read: false, createdAt: daysAgo(0) },
  { id: "ntf_3", userId: "usr_alex", type: "badge", subject: "You earned the First Steps badge", link: "/user/alex", read: true, createdAt: daysAgo(30) },
  { id: "ntf_4", userId: "usr_alex", fromUserId: "usr_maya", type: "reply", subject: "Maya replied to your question", message: "Great question — const prevents reassignment, not mutation.", link: "/courses/modern-javascript-fundamentals/learn/1-3", read: false, createdAt: daysAgo(1) },
  { id: "ntf_5", userId: "usr_sofia", type: "certificate", subject: "Your certificate is ready", message: "Congratulations on completing Modern JavaScript Fundamentals!", link: "/certificates/LL-7K2M-Q9ZX", read: true, createdAt: daysAgo(20) },
  { id: "ntf_6", userId: "usr_maya", fromUserId: "usr_alex", type: "assignment_graded", subject: "New assignment submission to grade", message: "Alex Johnson submitted Build a To-Do App.", link: "/admin/assignments/submissions", read: false, createdAt: daysAgo(1) },
];

const discussionTopics: DiscussionTopic[] = [
  { id: "dt_1", refType: "lesson", refId: "les_js_1_3", courseId: "crs_js", authorId: "usr_alex", title: "Why prefer const over let if I can still mutate objects?", createdAt: daysAgo(2), updatedAt: daysAgo(1) },
  { id: "dt_2", refType: "lesson", refId: "les_js_2_1", courseId: "crs_js", authorId: "usr_liam", title: "reduce with an object accumulator?", createdAt: daysAgo(5), updatedAt: daysAgo(5) },
  { id: "dt_3", refType: "batch", refId: "bat_react_weekend", batchId: "bat_react_weekend", authorId: "usr_sofia", title: "Can we get the slides from Saturday?", createdAt: daysAgo(6), updatedAt: daysAgo(5) },
];

const discussionReplies: DiscussionReply[] = [
  { id: "dr_1", topicId: "dt_1", authorId: "usr_alex", content: "I understand `const` stops reassignment, but `const arr = []; arr.push(1)` still works. So what's the point?", createdAt: daysAgo(2), updatedAt: daysAgo(2) },
  { id: "dr_2", topicId: "dt_1", authorId: "usr_maya", content: "Great question — `const` prevents **rebinding** the name, not mutating the value. It signals intent: *this identifier will always point at this thing*. Use `Object.freeze` if you need immutability.", createdAt: daysAgo(1), updatedAt: daysAgo(1) },
  { id: "dr_3", topicId: "dt_2", authorId: "usr_liam", content: "How do I count occurrences with reduce?", createdAt: daysAgo(5), updatedAt: daysAgo(5) },
  { id: "dr_4", topicId: "dt_3", authorId: "usr_sofia", content: "The recording is great but slides would help for revision.", createdAt: daysAgo(6), updatedAt: daysAgo(6) },
  { id: "dr_5", topicId: "dt_3", authorId: "usr_maya", content: "Uploaded to the batch resources — check Announcements.", createdAt: daysAgo(5), updatedAt: daysAgo(5) },
];

/* ------------------------------------------------------------------ */
/* Commerce, jobs                                                      */
/* ------------------------------------------------------------------ */

const payments: Payment[] = [
  { id: "pay_alex_react", orderId: "ORD-2K8F-33QA", userId: "usr_alex", itemType: "course", itemId: "crs_react", itemTitle: "React & Next.js: Build Production Apps", originalAmount: 4900, discountAmount: 0, taxAmount: 0, amount: 4900, currency: "USD", billingName: "Alex Johnson", address: { line1: "12 Congress Ave", city: "Austin", state: "TX", country: "United States", pincode: "78701" }, source: "Website", gateway: "manual", status: "paid", createdAt: daysAgo(12), paidAt: daysAgo(12) },
  { id: "pay_alex_batch", orderId: "ORD-9QZ1-77LM", userId: "usr_alex", itemType: "batch", itemId: "bat_js_cohort4", itemTitle: "JavaScript Bootcamp — Cohort 4", originalAmount: 19900, discountAmount: 3980, taxAmount: 0, amount: 15920, currency: "USD", couponId: "cpn_launch20", couponCode: "LAUNCH20", billingName: "Alex Johnson", address: { line1: "12 Congress Ave", city: "Austin", state: "TX", country: "United States", pincode: "78701" }, source: "Website", gateway: "manual", status: "paid", createdAt: daysAgo(6), paidAt: daysAgo(6) },
  { id: "pay_sofia_design", orderId: "ORD-4TTP-01BC", userId: "usr_sofia", itemType: "course", itemId: "crs_design", itemTitle: "UI Design Principles for Developers", originalAmount: 2900, discountAmount: 0, taxAmount: 0, amount: 2900, currency: "USD", billingName: "Sofia Martinez", address: { line1: "Calle Mayor 5", city: "Madrid", country: "Spain", pincode: "28013" }, source: "Website", gateway: "manual", status: "paid", createdAt: daysAgo(18), paidAt: daysAgo(18) },
  { id: "pay_liam_pending", orderId: "ORD-8HH2-56RD", userId: "usr_liam", itemType: "course", itemId: "crs_react", itemTitle: "React & Next.js: Build Production Apps", originalAmount: 4900, discountAmount: 0, taxAmount: 0, amount: 4900, currency: "USD", billingName: "Liam Walker", source: "Website", gateway: "manual", status: "pending", createdAt: daysAgo(1) },
];

const coupons: Coupon[] = [
  { id: "cpn_launch20", code: "LAUNCH20", discountType: "percentage", value: 20, expiresOn: dateKeyIn(60), usageLimit: 100, redemptionCount: 1, enabled: true, applicableItems: [], createdAt: daysAgo(30) },
  { id: "cpn_react10", code: "REACT10", discountType: "fixed", value: 1000, usageLimit: 0, redemptionCount: 0, enabled: true, applicableItems: [{ type: "course", id: "crs_react" }], createdAt: daysAgo(10) },
  { id: "cpn_expired", code: "SUMMER", discountType: "percentage", value: 50, expiresOn: dateKeyIn(-5), usageLimit: 10, redemptionCount: 10, enabled: false, applicableItems: [], createdAt: daysAgo(90) },
];

const jobs: JobOpening[] = [
  { id: "job_1", slug: "junior-frontend-developer-nimbus", title: "Junior Frontend Developer", company: "Nimbus Labs", companyWebsite: "https://example.com", location: "San Francisco, CA", remote: true, type: "full_time", description: `## About the role\n\nYou'll join a small team shipping React features weekly.\n\n## Requirements\n\n- Solid JavaScript\n- Some React experience\n- Curiosity`, salaryRange: "$85k – $110k", postedById: "usr_maya", status: "open", createdAt: daysAgo(7), updatedAt: daysAgo(7) },
  { id: "job_2", slug: "data-analyst-intern-orbit", title: "Data Analyst Intern", company: "Orbit", location: "Remote", remote: true, type: "internship", description: `Work with pandas and SQL on real product data. 3-month paid internship.`, salaryRange: "$25/hr", postedById: "usr_daniel", status: "open", createdAt: daysAgo(3), updatedAt: daysAgo(3) },
  { id: "job_3", slug: "product-designer-contract", title: "Product Designer (Contract)", company: "Flow Studio", location: "Bengaluru, India", remote: false, type: "contract", description: `6-month contract redesigning a fintech onboarding flow.`, postedById: "usr_priya", status: "closed", createdAt: daysAgo(40), updatedAt: daysAgo(2) },
];

const jobApplications: JobApplication[] = [
  { id: "japp_1", jobId: "job_1", userId: "usr_alex", coverLetter: "I'm finishing the Full-Stack path and would love to join Nimbus.", createdAt: daysAgo(2) },
  { id: "japp_2", jobId: "job_1", userId: "usr_sofia", coverLetter: "Career switcher with a marketing background and a certificate in JavaScript.", createdAt: daysAgo(1) },
];

/* ------------------------------------------------------------------ */
/* Assemble                                                            */
/* ------------------------------------------------------------------ */

export async function buildSeedDatabase(): Promise<Database> {
  const users = await buildUsers();
  return {
    users,
    sessions: [],
    categories,
    courses,
    chapters,
    lessons,
    questions,
    quizzes,
    quizSubmissions,
    quizViolations: [],
    assignments,
    assignmentSubmissions,
    exercises,
    exerciseSubmissions,
    enrollments,
    progress,
    videoWatches,
    notes,
    reviews,
    batches,
    batchEnrollments,
    batchFeedback: [
      { id: "bf_1", batchId: "bat_react_weekend", userId: "usr_sofia", feedback: "Loved the pace and the live coding.", contentRating: 5, instructorsRating: 5, valueRating: 4, createdAt: daysAgo(4) },
    ],
    liveClasses,
    announcements,
    emailTemplates,
    programs,
    programMembers,
    certificates,
    certificateRequests: [
      { id: "creq_1", courseId: "crs_design", userId: "usr_sofia", evaluatorId: "usr_priya", date: dateKeyIn(4), startTime: "10:00", endTime: "10:30", timezone: "Asia/Kolkata", meetingLink: "https://meet.example.com/eval-sofia", status: "upcoming", createdAt: daysAgo(2) },
    ],
    certificateEvaluations: [
      { id: "ceval_1", courseId: "crs_js", userId: "usr_sofia", evaluatorId: "usr_admin", rating: 5, summary: "Excellent understanding of async patterns.", date: daysAgo(21).slice(0, 10), startTime: "10:00", endTime: "10:30", status: "pass", createdAt: daysAgo(21) },
    ],
    evaluatorSlots,
    badges,
    badgeAssignments,
    activities,
    notifications,
    discussionTopics,
    discussionReplies,
    payments,
    coupons,
    jobs,
    jobApplications,
    emails: [],
    authTokens: [],
    loginEvents: [],
    points: [],
    settings: defaultSettings(),
  };
}
