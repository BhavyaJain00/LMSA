import type { BlogPost, LegalPage } from "@/lib/types";
import { readingTimeSeconds } from "@/lib/utils";

/**
 * Round 3 demo content: two original blog posts and starter legal pages.
 *
 * Kept apart from `seed.ts` so the long-form text does not drown the rest of
 * the demo data. Everything here is original copy written for LearnLoop.
 * Legal pages are unpublished templates: an administrator must review them
 * (ideally with a lawyer) and publish them from Admin → Settings → Legal pages.
 */

const LEGAL_TEMPLATE_NOTICE = "Template — review with a lawyer before publishing.";

/* ------------------------------------------------------------------ */
/* Blog                                                                */
/* ------------------------------------------------------------------ */

const JS_ROADMAP = `
Learning JavaScript in 2026 is easier to start and harder to finish than ever. There are thousands of tutorials, a new framework every season and an AI assistant that will happily write code you do not understand. The result is that many learners spend months "learning JavaScript" without ever feeling ready to build something on their own. This roadmap is the order we recommend to every LearnLoop student, and the reasoning behind each step.

## Step 1: Learn the language before the ecosystem

The single biggest mistake we see is jumping straight into React, Next.js or a bundler before the language itself feels natural. Frameworks are built from ordinary JavaScript: functions, objects, arrays, closures and promises. When those pieces are shaky, every framework error message looks like magic.

Spend your first few weeks on the fundamentals:

- **Values and types** — strings, numbers, booleans, \`null\`, \`undefined\`, objects and arrays, and how equality works between them.
- **Functions** — declarations, arrow functions, default parameters and returning values instead of printing them.
- **Scope and closures** — why a function "remembers" the variables around it, and why that matters for event handlers.
- **Array methods** — \`map\`, \`filter\`, \`reduce\`, \`find\` and \`some\` will replace most of the loops you write.

A good test: can you read a thirty-line function you did not write and explain what it returns? If yes, you are ready for the next step.

## Step 2: Understand asynchronous code early

Almost everything interesting on the web is asynchronous: loading data, waiting for a click, saving a form. Learners who postpone promises and \`async\`/\`await\` end up copying snippets they cannot debug.

Start with the mental model. JavaScript runs one thing at a time, and slow work (network requests, timers) is handed off and picked up later. A promise is simply a placeholder for a value that will arrive in the future. \`await\` pauses the current function — not the whole page — until that value is ready.

Practise by fetching data from a public API, showing a loading message while you wait and an error message when the request fails. Those three states — loading, success and failure — show up in every real application you will ever build.

## Step 3: Work with the browser directly

Before you reach for a framework, build two or three small pages using nothing but the DOM. Select elements, listen for events, update text and toggle classes. A to-do list, a tip calculator and a small quiz are perfect first projects.

This step teaches you what frameworks are actually doing for you. When you later learn that React "re-renders" a component, you will know it is ultimately updating the same DOM you manipulated by hand — just more systematically.

## Step 4: Adopt professional habits

Somewhere between your second and fourth project, start working the way professional developers do:

1. **Use version control.** Commit small, meaningful changes with clear messages. Your future self is your most frequent collaborator.
2. **Read error messages carefully.** The stack trace usually names the exact file and line. Most bugs are found by reading, not guessing.
3. **Use the debugger.** A breakpoint shows you the real values of your variables, which is faster than scattering console logs.
4. **Add types gradually.** TypeScript catches whole categories of mistakes before your code runs, and it makes editors dramatically more helpful.

## Step 5: Pick one framework and build something real

Only now is it time for React or a similar library. Because you understand functions, closures and asynchronous code, concepts such as components, props, state and effects will map onto things you already know.

Choose a project you would actually use — a reading tracker, a budget planner, a workout log — and take it all the way to deployment. Finishing one complete project teaches more than starting ten.

## How to use AI assistants without skipping the learning

AI tools are excellent study partners when you use them to *explain* rather than to *replace* your thinking. Ask them why a piece of code works, request a smaller example of a confusing concept, or have them review a solution you already wrote. Avoid pasting in an exercise and submitting whatever comes back: you will pass the exercise and fail the interview.

## A realistic timeline

With five to eight focused hours a week, most of our learners move through steps one to three in about two months, and are building and deploying framework-based projects by month four. Consistency matters far more than intensity: thirty minutes every day beats a single exhausting weekend.

If you want a structured path, our **Modern JavaScript Fundamentals** course covers steps one to four with quizzes and hands-on exercises, and **React & Next.js: Build Production Apps** picks up at step five.
`;

const WEB_PORTFOLIO = `
A portfolio is the bridge between "I have been learning web development" and "I can do this job". Hiring managers and freelance clients rarely read certificates closely; they click links. The good news is that a convincing portfolio does not need dozens of projects. It needs three or four carefully chosen ones, presented well. Here is how we coach LearnLoop students to build theirs.

## What reviewers actually look for

When someone opens your portfolio they are quietly asking three questions:

- **Can this person build things that work?** Live links that load quickly and do not break on a phone answer this immediately.
- **Can they explain their decisions?** A short write-up of why you chose an approach shows judgement, not just typing speed.
- **Would they be pleasant to work with?** Clean code, a readable README and honest notes about trade-offs signal a thoughtful collaborator.

Notice that none of these questions is "how many projects are there?". Quality and clarity win.

## Choose projects that show range

A strong starter portfolio usually contains:

1. **An interface-heavy project** — a responsive dashboard, a booking form with validation or an interactive quiz. It shows you care about layout, accessibility and user experience.
2. **A data project** — something that loads, filters and displays information from an API, with proper loading and error states.
3. **A full-stack project** — an app with accounts, a database and at least one feature that saves data, deployed where anyone can try it.
4. **Optionally, a contribution** — a small fix to an open-source project or a tool you built for a real person, such as a club, a family business or a colleague.

Avoid building the same tutorial project everyone else has. If you followed a course to make a weather app, extend it: add saved locations, offline support or a comparison view. The extension is the part that proves you can work independently.

## Write a case study for each project

Every project deserves a short page or README section that covers:

- **The problem** in one or two sentences.
- **Your approach**, including one decision you considered and rejected.
- **The hardest bug** and how you found it.
- **What you would do next** with more time.

This takes an evening per project and is the single highest-value thing you can add. It turns a link into a conversation starter for interviews.

## Polish the details that are easy to miss

Small details separate portfolios that feel finished from those that feel abandoned:

- Test every page on a phone-sized screen.
- Give images descriptive alternative text and make sure the site is usable with a keyboard.
- Replace any default favicon and page title.
- Remove unused starter files and commented-out code from your repositories.
- Make sure demo accounts, if you need them, are listed clearly with their passwords.

Run an accessibility and performance audit in your browser's developer tools and fix the obvious issues. Reviewers notice a site that loads instantly.

## Keep it current without starting over

Treat your portfolio as a living project. Every few months, replace your weakest project with something better rather than adding endlessly. Update the case studies as your understanding grows — it is perfectly fine to write "today I would structure this differently, and here is why". That sentence alone demonstrates growth.

## Where courses fit in

Structured courses are the fastest way to fill knowledge gaps, and their projects make excellent starting points for portfolio pieces. The key is to finish the course project, then make it yours. Students in our **React & Next.js: Build Production Apps** course, for example, extend the capstone with their own features before adding it to their portfolio, and learners who are earlier in the journey start with **Modern JavaScript Fundamentals** to build the foundation those projects rely on.

## Your next step

Pick one project you have already built. Deploy it if it is not live, write its case study and ask a friend to try it on their phone while you watch silently. Fix what confuses them. Repeat for your next project, and within a month you will have a portfolio you are proud to share.
`;

export function buildSeedBlogPosts(now: Date): BlogPost[] {
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  return [
    {
      id: "post_js_roadmap",
      slug: "javascript-learning-roadmap",
      title: "A Practical JavaScript Learning Roadmap for 2026",
      excerpt:
        "The order we recommend for learning JavaScript — from language fundamentals and async code to the browser, professional habits and your first framework — plus a realistic timeline.",
      content: JS_ROADMAP.trim(),
      authorId: "usr_maya",
      categoryIds: ["cat_web", "cat_prog"],
      tags: ["javascript", "roadmap", "beginners"],
      status: "published",
      publishedAt: at(9),
      seoTitle: "JavaScript Learning Roadmap (2026): What to Learn and in What Order",
      seoDescription:
        "A step-by-step JavaScript roadmap: fundamentals, async/await, the DOM, professional habits and when to start React, with a realistic timeline.",
      focusKeyword: "javascript roadmap",
      faq: [
        {
          question: "How long does it take to learn JavaScript?",
          answer:
            "With five to eight focused hours a week, most learners are comfortable with the fundamentals in about two months and are building framework-based projects by month four.",
        },
        {
          question: "Should I learn React before JavaScript?",
          answer:
            "No. React is built from ordinary JavaScript. Learn functions, objects, arrays, closures and promises first, and React concepts will map onto things you already understand.",
        },
        {
          question: "Is it okay to use AI assistants while learning?",
          answer:
            "Yes, as long as you use them to explain concepts and review your own solutions rather than to write exercises for you. Understanding the code is the part that matters in interviews and on the job.",
        },
      ],
      relatedCourseIds: ["crs_js", "crs_react"],
      readingTimeSeconds: readingTimeSeconds(JS_ROADMAP),
      views: 412,
      createdAt: at(12),
      updatedAt: at(9),
    },
    {
      id: "post_web_portfolio",
      slug: "build-a-web-developer-portfolio",
      title: "How to Build a Web Developer Portfolio That Gets Replies",
      excerpt:
        "Three or four well-chosen projects, each with a short case study, beat a long list of tutorials. Here is how to pick, present and polish them.",
      content: WEB_PORTFOLIO.trim(),
      authorId: "usr_maya",
      categoryIds: ["cat_web"],
      tags: ["career", "portfolio", "web development"],
      status: "published",
      publishedAt: at(3),
      seoTitle: "How to Build a Web Developer Portfolio (With Project Ideas)",
      seoDescription:
        "What reviewers look for in a web developer portfolio, which projects to include, how to write case studies and the details that make it feel finished.",
      focusKeyword: "web developer portfolio",
      faq: [
        {
          question: "How many projects should a web developer portfolio have?",
          answer:
            "Three or four strong, finished projects are enough. Choose ones that show range — an interface-heavy app, a data project and a full-stack app — and write a short case study for each.",
        },
        {
          question: "Can I include course projects in my portfolio?",
          answer:
            "Yes, but extend them first. Add features of your own so the project shows independent work rather than a followed tutorial.",
        },
        {
          question: "Do I need a custom domain for my portfolio?",
          answer:
            "It helps it look professional and is inexpensive, but it matters far less than live, working projects and clear write-ups.",
        },
      ],
      relatedCourseIds: ["crs_js", "crs_react"],
      readingTimeSeconds: readingTimeSeconds(WEB_PORTFOLIO),
      views: 187,
      createdAt: at(5),
      updatedAt: at(3),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Legal pages                                                         */
/* ------------------------------------------------------------------ */

const PRIVACY = `
${LEGAL_TEMPLATE_NOTICE}

This policy explains what personal information LearnLoop Academy ("we", "us") collects when you use this learning platform, why we collect it and the choices you have.

## Information we collect

- **Account details** — your name, email address, password (stored only as a secure hash) and any profile information you choose to add, such as a headline, biography or social links.
- **Learning activity** — courses and batches you join, lessons you complete, quiz and assignment submissions, notes, discussion posts, certificates and points.
- **Payment records** — the items you buy, amounts, billing name and address. Card details are handled by our payment provider and never reach our servers.
- **Technical data** — IP address, browser type, sign-in times and security events, used to keep accounts safe.
- **Cookies** — see our Cookie Policy for details.

## How we use it

We use your information to provide and improve the courses you enrol in, issue certificates, process payments, send the emails you have asked for, keep the platform secure and meet our legal obligations. We do not sell your personal information.

## Sharing

We share information only with service providers that help us run the platform (for example hosting, email delivery and payment processing), with instructors of the courses you join (limited to your progress and submissions), and where the law requires it.

## Retention

We keep account data while your account is active. Logs and inactive records are removed after the retention period configured by the platform administrator. You can ask us to delete your account at any time.

## Your rights

Depending on where you live, you may have the right to access, correct, export or delete your personal information, and to object to or restrict certain processing. You can export your data or request deletion from your account settings, or contact us using the details below.

## Children

This platform is not directed at children under the age required by local law to consent to online services without a parent's permission.

## Changes

We will post any changes to this policy on this page and update the date below. Significant changes will be announced by email or in the app.

## Contact

Questions about privacy can be sent to the contact address shown in the footer of this site.
`;

const TERMS = `
${LEGAL_TEMPLATE_NOTICE}

These terms govern your use of the LearnLoop Academy learning platform. By creating an account or using the site you agree to them.

## Your account

You are responsible for keeping your password and any two-factor codes secure and for all activity under your account. Provide accurate information and keep it up to date. Accounts are personal and may not be shared.

## Courses and content

When you enrol in a course you receive a personal, non-transferable licence to access its content for your own learning. You may not copy, redistribute, resell or publicly share course materials, videos or assessments without written permission from the rights holder.

## Your contributions

You keep ownership of the notes, submissions and discussion posts you create. You give us permission to store and display them as needed to run the platform — for example, showing your discussion replies to other learners in the same course. Do not post content that is unlawful, infringing, harassing or misleading.

## Payments

Prices are shown before checkout, including any applicable taxes. Payments are processed by third-party providers. Refunds are handled according to our Refund Policy.

## Certificates

Certificates confirm that you completed the requirements of a course or batch on this platform. They are not academic degrees or professional licences unless explicitly stated.

## Acceptable use

Do not attempt to break or bypass security features, access other people's accounts, scrape content at scale, share answers to assessments or disrupt the service for others. We may suspend accounts that break these rules.

## Availability and changes

We work to keep the platform available but cannot guarantee uninterrupted access. We may update features, courses and these terms; if a change materially affects you, we will give reasonable notice.

## Liability

To the extent permitted by law, the platform is provided "as is" and our total liability for any claim is limited to the amount you paid us in the twelve months before the claim.

## Contact

Questions about these terms can be sent to the contact address shown in the footer of this site.
`;

const REFUNDS = `
${LEGAL_TEMPLATE_NOTICE}

We want you to be happy with what you learn at LearnLoop Academy. This policy explains when you can get your money back.

## Courses

You can request a full refund within **14 days** of purchase if you have completed less than **30%** of the course. After that window, or once you have downloaded a certificate for the course, purchases are non-refundable.

## Batches and cohorts

Live batches can be refunded in full up to **7 days** before the batch starts. After the start date we can offer a transfer to a later batch, where one is available, instead of a refund.

## Certificates

Paid certificates are non-refundable once issued.

## How to request a refund

Contact us from the email address on your account and include your order number (shown on your receipt and in your purchase history). Approved refunds are returned to the original payment method; your bank may take 5–10 business days to show the credit.

## Effect of a refund

When a refund is issued, access to the refunded course or batch ends and any certificate issued for it is revoked.

## Your statutory rights

Nothing in this policy limits any rights you have under the consumer laws of your country.
`;

const COOKIES = `
${LEGAL_TEMPLATE_NOTICE}

This page explains how LearnLoop Academy uses cookies and similar technologies.

## Essential cookies

These keep the site working and cannot be switched off:

- **Session cookie** — keeps you signed in securely.
- **Security cookies** — protect sign-in flows and forms against misuse.
- **Preference cookies** — remember choices such as your colour theme and your cookie decision.

## Analytics cookies (optional)

With your permission, we use privacy-conscious analytics to understand which pages are useful and where learners get stuck. These cookies are only set after you accept analytics in the cookie banner.

## Marketing cookies (optional)

With your permission, we may use marketing cookies to measure the effectiveness of our advertising. They are only set after you accept marketing cookies.

## Managing your choice

You can change your decision at any time from the "Cookie settings" link in the site footer. You can also block or delete cookies in your browser settings, although parts of the site may stop working if essential cookies are blocked.

## Changes

We will update this page if we start using new kinds of cookies.
`;

export function buildSeedLegalPages(now: Date): LegalPage[] {
  const updatedAt = now.toISOString();
  const page = (slug: string, title: string, content: string): LegalPage => ({
    id: `legal_${slug}`,
    slug,
    title,
    content: content.trim(),
    updatedAt,
    version: 1,
    published: false,
  });
  return [
    page("privacy", "Privacy Policy", PRIVACY),
    page("terms", "Terms of Service", TERMS),
    page("refunds", "Refund Policy", REFUNDS),
    page("cookies", "Cookie Policy", COOKIES),
  ];
}

export { LEGAL_TEMPLATE_NOTICE };
