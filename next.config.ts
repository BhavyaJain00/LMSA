import path from "node:path";
import type { NextConfig } from "next";

type LegacyRedirect = {
  source: string;
  destination: string;
  /** 308 for straight renames; 307 where the old URL can only be approximated. */
  permanent: boolean;
  has?: { type: "query"; key: string; value?: string }[];
};

/**
 * Frappe LMS URLs mapped onto this app's routes, so old bookmarks, emails and links
 * keep working. Query strings are passed through to the destination automatically.
 * Redirects run before the filesystem, so the more specific entries come first and
 * every source here is a path this app does not serve itself.
 */
const legacyRedirects: LegacyRedirect[] = [
  // Frappe serves its SPA under /lms; strip the prefix, then the rules below apply.
  { source: "/lms", destination: "/", permanent: true },
  { source: "/lms/:path+", destination: "/:path+", permanent: true },

  // Courses (?newCourse=1 on /courses is handled by the catalog page itself).
  { source: "/courses/new", destination: "/admin/courses/new", permanent: true },
  { source: "/courses/import", destination: "/admin/courses/import", permanent: true },

  // Batches
  { source: "/batches/new", destination: "/admin/batches/new", permanent: true },
  { source: "/batches/details/:slug", destination: "/batches/:slug", permanent: true },

  // Programs: Frappe keys programs by name, which is not our admin id.
  { source: "/programs/new/edit", destination: "/admin/programs/new", permanent: true },
  { source: "/programs/:name/edit", destination: "/admin/programs", permanent: false },

  // Jobs: /jobs/<x> resolves both slugs and ids and links managers to edit and applications.
  { source: "/job-openings", destination: "/jobs", permanent: true },
  { source: "/job-openings/:job/applications", destination: "/jobs/:job", permanent: false },
  { source: "/job-openings/:job", destination: "/jobs/:job", permanent: true },
  { source: "/job-opening/new/edit", destination: "/admin/jobs/new", permanent: true },
  { source: "/job-opening/:job/edit", destination: "/jobs/:job", permanent: false },

  // Quizzes
  { source: "/quizzes", destination: "/admin/quizzes", permanent: true },
  { source: "/quizzes/new", destination: "/admin/quizzes/new", permanent: true },
  { source: "/quizzes/questions", destination: "/admin/questions", permanent: true },
  { source: "/quizzes/submissions", destination: "/admin/quizzes/submissions", permanent: true },
  { source: "/quizzes/edit/new", destination: "/admin/quizzes/new", permanent: true },
  { source: "/quizzes/edit/:id", destination: "/admin/quizzes/:id", permanent: true },
  { source: "/quizzes/:id/question/:question", destination: "/admin/quizzes/:id", permanent: true },
  { source: "/quizzes/:id", destination: "/admin/quizzes/:id", permanent: true },
  { source: "/quiz-submission/:id", destination: "/quiz/submissions/:id", permanent: true },
  { source: "/quiz-submissions/:quiz", destination: "/admin/quizzes/submissions?quiz=:quiz", permanent: true },

  // Assignments (/assignments/<id> is our learner page, so only the list and "new" move).
  { source: "/assignments", destination: "/admin/assignments", permanent: true },
  { source: "/assignments/new", destination: "/admin/assignments/new", permanent: true },
  {
    source: "/assignment-submissions",
    has: [{ type: "query", key: "assignmentID", value: "(?<assignment>.+)" }],
    destination: "/admin/assignments/submissions?assignment=:assignment",
    permanent: true,
  },
  { source: "/assignment-submissions", destination: "/admin/assignments/submissions", permanent: true },
  // Learners submit and review their own work on the assignment page; graders reach it from there too.
  { source: "/assignment-submission/:assignment/:submission", destination: "/assignments/:assignment", permanent: false },

  // Programming exercises
  { source: "/programming-exercises", destination: "/admin/exercises", permanent: true },
  { source: "/programming-exercises/edit/new", destination: "/admin/exercises/new", permanent: true },
  { source: "/programming-exercises/edit/:id", destination: "/admin/exercises/:id", permanent: true },
  { source: "/programming-exercises/submissions", destination: "/exercises/submissions", permanent: true },
  { source: "/programming-exercises/:exercise/submission/new", destination: "/exercises/:exercise", permanent: true },
  { source: "/programming-exercises/:exercise/submission/:submission", destination: "/exercises/submissions/:submission", permanent: true },

  // People
  { source: "/certified-participants", destination: "/certified-members", permanent: true },
  { source: "/settings/users/new", destination: "/admin/members/new", permanent: true },
  { source: "/settings/users/:member", destination: "/admin/members", permanent: false },
];

/** Short, memorable addresses for the legal pages (the pages themselves live under /legal). */
const legalRedirects: LegacyRedirect[] = [
  { source: "/privacy", destination: "/legal/privacy", permanent: true },
  { source: "/privacy-policy", destination: "/legal/privacy", permanent: true },
  { source: "/terms", destination: "/legal/terms", permanent: true },
  { source: "/terms-of-service", destination: "/legal/terms", permanent: true },
  { source: "/refund-policy", destination: "/legal/refunds", permanent: true },
  { source: "/refunds", destination: "/legal/refunds", permanent: true },
  { source: "/cookie-policy", destination: "/legal/cookies", permanent: true },
];

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy. Inline scripts stay allowed (theme bootstrap, JSON-LD,
 * Next's own inline payloads). 'unsafe-eval' is required because the programming
 * exercise runner evaluates learner code with `new Function` inside Blob workers,
 * which inherit this policy (and React Refresh needs it in development).
 * Third-party scripts: Razorpay checkout, Google Analytics and the Meta Pixel
 * (both loaded only after cookie consent). Stripe Checkout is a redirect, so it
 * only needs `form-action`.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://www.googletagmanager.com https://connect.facebook.net",
  "frame-src 'self' https:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https:" + (isDev ? " ws: wss:" : ""),
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders: { key: string; value: string }[] = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), fullscreen=(self), picture-in-picture=(self), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // Browsers ignore HSTS on plain HTTP, and in development it would pin localhost to HTTPS.
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for Docker (`node server.js`); see Dockerfile and DEPLOYMENT.md.
  output: "standalone",
  // Pin the workspace root to this project so a stray lockfile in a parent
  // directory is not picked up as the Turbopack root.
  turbopack: {
    root: path.resolve(__dirname),
  },
  poweredByHeader: false,
  images: {
    // Course covers, avatars and blog images may come from any HTTPS host (or a CDN in front of storage).
    remotePatterns: [{ protocol: "https", hostname: "**" }],
    formats: ["image/avif", "image/webp"],
    qualities: [60, 75, 90],
    minimumCacheTTL: 60 * 60 * 24,
  },
  async redirects() {
    return [...legacyRedirects, ...legalRedirects];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The service worker must always be revalidated so a new VERSION reaches browsers promptly.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
