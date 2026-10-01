import type { Bundle, Conversation, DirectMessage, Lesson, MembershipPlan, Rubric, TaxRule, Transcript, TranscriptCue, Upsell } from "@/lib/types";

/**
 * Round 3 wave B demo data: membership plans, a course bundle, example tax
 * rules, a grading rubric, an order-bump offer, a direct-message
 * conversation and a video transcript. Kept apart from `seed.ts` like the
 * other round 3 demo content. Amounts are in the smallest currency unit (cents).
 */

const hoursBefore = (now: Date, hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

const ALL_ACCESS_FEATURES = [
  "Every published course, including new releases",
  "Certificates for every course you finish",
  "Quizzes, assignments and hands-on exercises",
  "Community discussions and live class recordings",
];

export function buildSeedPlans(now: Date): MembershipPlan[] {
  const created = hoursBefore(now, 24 * 20);
  return [
    {
      id: "plan_all_monthly",
      slug: "all-access-monthly",
      name: "All-Access Monthly",
      description:
        "Unlimited access to the whole catalog, billed every month. Start with a 7-day free trial and cancel any time before it ends to pay nothing.",
      interval: "month",
      price: 1900,
      currency: "USD",
      trialDays: 7,
      access: { type: "all" },
      active: true,
      features: [...ALL_ACCESS_FEATURES, "7-day free trial, cancel any time"],
      createdAt: created,
      updatedAt: created,
    },
    {
      id: "plan_all_yearly",
      slug: "all-access-yearly",
      name: "All-Access Yearly",
      description:
        "Everything in the monthly membership for a full year, at roughly the price of eight months. Best value for learners following a complete path.",
      interval: "year",
      price: 15900,
      currency: "USD",
      trialDays: 0,
      access: { type: "all" },
      active: true,
      features: [...ALL_ACCESS_FEATURES, "Save 30% compared with paying monthly"],
      createdAt: created,
      updatedAt: created,
    },
  ];
}

export function buildSeedBundles(now: Date): Bundle[] {
  const created = hoursBefore(now, 24 * 15);
  return [
    {
      id: "bnd_fullstack_starter",
      slug: "full-stack-starter-bundle",
      title: "Full-Stack Starter Bundle",
      description: `Learn the language first, then ship production apps with it.

- **Modern JavaScript Fundamentals** gives you a solid command of the language: types, functions, arrays, async code and the DOM.
- **React & Next.js: Build Production Apps** takes you from a blank folder to a deployed application with the App Router, Server Actions and authentication.

Buying both together costs less than the courses separately, and you keep access to both for good.`,
      courseIds: ["crs_js", "crs_react"],
      price: 5900,
      currency: "USD",
      published: true,
      createdAt: created,
      updatedAt: created,
    },
  ];
}

export function buildSeedTaxRules(): TaxRule[] {
  return [
    { id: "tax_in_gst", country: "IN", name: "GST", rate: 18, inclusive: false },
    { id: "tax_gb_vat", country: "GB", name: "VAT", rate: 20, inclusive: true },
    { id: "tax_de_vat", country: "DE", name: "VAT", rate: 19, inclusive: true },
  ];
}

export function buildSeedRubrics(now: Date): Rubric[] {
  const created = hoursBefore(now, 24 * 10);
  return [
    {
      id: "rub_project",
      title: "Project rubric",
      passPercent: 60,
      createdById: "usr_maya",
      createdAt: created,
      updatedAt: created,
      criteria: [
        {
          id: "crit_functionality",
          title: "Functionality",
          description: "Does the project do what the brief asks, including edge cases?",
          levels: [
            { label: "Missing", points: 0, description: "The core features do not work." },
            { label: "Partial", points: 4, description: "Some required features work; others are missing or broken." },
            { label: "Complete", points: 8, description: "Every required feature works for the expected inputs." },
            { label: "Robust", points: 10, description: "Everything works, and invalid input and edge cases are handled gracefully." },
          ],
        },
        {
          id: "crit_code_quality",
          title: "Code quality",
          description: "Is the code readable, well organised and free of needless repetition?",
          levels: [
            { label: "Hard to follow", points: 0, description: "Unclear names, long functions, copy-pasted logic." },
            { label: "Readable", points: 3, description: "Mostly clear, with a few long or repeated sections." },
            { label: "Clean", points: 6, description: "Small focused functions, clear names, no duplication." },
          ],
        },
        {
          id: "crit_presentation",
          title: "Presentation",
          description: "Is the work explained so a reviewer can run and understand it?",
          levels: [
            { label: "None", points: 0, description: "No explanation or instructions." },
            { label: "Basic", points: 2, description: "A short description of what was built." },
            { label: "Clear", points: 4, description: "Setup steps, decisions made and known limitations are documented." },
          ],
        },
      ],
    },
  ];
}

/** Order bump shown at the React course checkout: the design course at 20% off. */
export function buildSeedUpsells(now: Date): Upsell[] {
  return [
    {
      id: "ups_react_design",
      triggerItemType: "course",
      triggerItemId: "crs_react",
      offerItemType: "course",
      offerItemId: "crs_design",
      discountPercent: 20,
      headline: "Make your apps look as good as they work: add UI Design Principles for Developers at 20% off.",
      active: true,
      createdAt: hoursBefore(now, 24 * 6),
    },
  ];
}

/** A short exchange between the demo learner and the demo instructor about the JavaScript course. */
export function buildSeedConversations(now: Date): { conversations: Conversation[]; directMessages: DirectMessage[] } {
  const at = (hours: number) => hoursBefore(now, hours);
  const directMessages: DirectMessage[] = [
    {
      id: "dm_alex_maya_1",
      conversationId: "cnv_alex_maya",
      senderId: "usr_alex",
      body: "Hi Maya! In the closures lesson, why does the counter keep its value between calls? I expected it to reset every time.",
      readBy: ["usr_alex", "usr_maya"],
      createdAt: at(30),
    },
    {
      id: "dm_alex_maya_2",
      conversationId: "cnv_alex_maya",
      senderId: "usr_maya",
      body: "Good question! The inner function keeps a reference to the variables of the function that created it, so `count` lives on after `makeCounter()` returns. Each call to `makeCounter()` creates a fresh `count`, which is why two counters don't share it.",
      readBy: ["usr_maya", "usr_alex"],
      createdAt: at(28),
    },
    {
      id: "dm_alex_maya_3",
      conversationId: "cnv_alex_maya",
      senderId: "usr_alex",
      body: "That makes sense now, thanks! I'll try building two counters side by side to see it.",
      readBy: ["usr_alex"],
      createdAt: at(27),
    },
  ];
  return {
    conversations: [
      {
        id: "cnv_alex_maya",
        participantIds: ["usr_alex", "usr_maya"],
        courseId: "crs_js",
        subject: "Question about closures",
        lastMessageAt: directMessages[directMessages.length - 1]!.createdAt,
        createdAt: directMessages[0]!.createdAt,
      },
    ],
    directMessages,
  };
}

/** Transcript id set on the welcome video of the JavaScript course (`seed.ts`). */
export const SEED_WELCOME_TRANSCRIPT_ID = "trn_js_welcome";

const WELCOME_CUES: [number, number, string][] = [
  [0, 3.2, "Hi, and welcome to Modern JavaScript Fundamentals."],
  [3.2, 6.4, "I'm Maya, and I'll be your instructor for this course."],
  [6.4, 9.6, "JavaScript runs in every browser and on the server with Node.js,"],
  [9.6, 12.8, "so what you learn here works almost everywhere."],
  [12.8, 16, "We'll start by setting up Node.js and VS Code on your computer."],
  [16, 19.2, "Then we'll cover variables, types and operators,"],
  [19.2, 22.4, "functions, and the array methods you'll use every day."],
  [22.4, 25.6, "After that we'll look at objects, closures and asynchronous code"],
  [25.6, 28.8, "with promises and async and await."],
  [28.8, 32, "Every chapter ends with a small project you build yourself,"],
  [32, 35.2, "and the final assignment is a to-do app you can show off."],
  [35.2, 38.4, "Use the quizzes to check your understanding as you go,"],
  [38.4, 41.6, "and ask questions in the discussions whenever you get stuck."],
  [41.6, 44.8, "Take your time, write lots of code, and have fun."],
  [44.8, 47, "Let's get started!"],
];

/** A ready, hand-written transcript for the JavaScript course's welcome video. */
export function buildSeedTranscripts(lessons: Lesson[], now: Date): Transcript[] {
  for (const lesson of lessons) {
    const block = lesson.blocks.find((b) => b.type === "video" && b.transcriptId === SEED_WELCOME_TRANSCRIPT_ID);
    if (!block) continue;
    const created = hoursBefore(now, 24 * 20);
    const cues: TranscriptCue[] = WELCOME_CUES.map(([start, end, text]) => ({ start, end, text }));
    return [{ id: SEED_WELCOME_TRANSCRIPT_ID, lessonId: lesson.id, blockId: block.id, language: "en", cues, source: "manual", status: "ready", createdAt: created, updatedAt: created }];
  }
  return [];
}
