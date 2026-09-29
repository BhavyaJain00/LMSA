import type { Bundle, MembershipPlan, Rubric, TaxRule } from "@/lib/types";

/**
 * Round 3 wave B demo data: membership plans, a course bundle, example tax
 * rules and a grading rubric. Kept apart from `seed.ts` like the other
 * round 3 demo content. Amounts are in the smallest currency unit (cents).
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
