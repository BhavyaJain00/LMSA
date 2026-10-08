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
 * Next's own inline payloads). 'unsafe-eval' is added only in development (React
 * Refresh): the programming exercise runner, the one feature that evaluates code,
 * loads its worker and its sandboxed frame from `/api/exercise-runner/*`, whose
 * responses carry their own narrow policy (`runnerHeaders` below).
 * Third-party scripts: Razorpay checkout, Google Analytics and the Meta Pixel
 * (both loaded only after cookie consent). Stripe Checkout is a redirect, so it
 * only needs `form-action`. PDF lesson blocks and submitted PDFs are previewed in
 * an `<iframe>` (allowed by `frame-src`), so `object-src` stays `'none'`.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (isDev ? " 'unsafe-eval'" : "") + " https://checkout.razorpay.com https://www.googletagmanager.com https://connect.facebook.net",
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

/**
 * The exercise runner's own documents (see `src/components/assessments/js-runner-source.ts`).
 * A worker loaded from a URL, and a framed document, are governed by the policy of
 * their own response, so only these two responses allow `new Function`:
 * - the worker runs the viewer's own code (same origin, no DOM);
 * - the frame is loaded with `sandbox="allow-scripts"` (opaque origin, no cookies)
 *   and runs code the viewer did not write in Blob workers, which inherit this policy.
 * These rules come after the site-wide one, so their CSP replaces it.
 */
const runnerHeaders: { source: string; headers: { key: string; value: string }[] }[] = [
  {
    source: "/api/exercise-runner/worker",
    headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'self' https:" }],
  },
  {
    source: "/api/exercise-runner/frame",
    headers: [
      {
        key: "Content-Security-Policy",
        value: "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; worker-src blob: data:; connect-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      },
    ],
  },
];

/** `https://host[:port]` (or http for a local APP_URL) as an image remote pattern; null when unusable. */
function hostPattern(raw: string | undefined, allowHttp = false): { protocol: "https" | "http"; hostname: string; port?: string } | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    const protocol = url.protocol === "https:" ? "https" : url.protocol === "http:" && allowHttp ? "http" : null;
    if (!protocol || !url.hostname) return null;
    return { protocol, hostname: url.hostname, ...(url.port ? { port: url.port } : {}) };
  } catch {
    return null;
  }
}

/**
 * Hosts the image optimizer (`/_next/image`) may fetch from: this site, the
 * object-storage bucket or its CDN, and any extra hosts listed in IMAGE_HOSTS
 * (comma-separated, `*.example.com` allowed). Allowing every HTTPS host would turn
 * the optimizer into an open proxy that downloads and re-encodes anyone's images
 * on this server's CPU and disk. Read when the app is built.
 */
export function imageRemotePatterns(env: Record<string, string | undefined> = process.env): { protocol: "https" | "http"; hostname: string; port?: string }[] {
  const out: { protocol: "https" | "http"; hostname: string; port?: string }[] = [];
  const push = (p: { protocol: "https" | "http"; hostname: string; port?: string } | null) => {
    if (p && !out.some((o) => o.protocol === p.protocol && o.hostname === p.hostname && o.port === p.port)) out.push(p);
  };
  push(hostPattern(env.APP_URL, true));
  push(hostPattern(env.S3_PUBLIC_BASE_URL));
  const endpoint = hostPattern(env.S3_ENDPOINT);
  const bucket = (env.S3_BUCKET ?? "").trim();
  if (endpoint) {
    push(endpoint);
    if (bucket) push({ ...endpoint, hostname: `${bucket}.${endpoint.hostname}` });
  } else if (bucket && (env.STORAGE_DRIVER ?? "").trim().toLowerCase() === "s3") {
    push({ protocol: "https", hostname: `${bucket}.s3.amazonaws.com` });
    push({ protocol: "https", hostname: `${bucket}.s3.*.amazonaws.com` });
  }
  for (const host of (env.IMAGE_HOSTS ?? "").split(",")) {
    const name = host.trim().toLowerCase();
    if (/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) push({ protocol: "https", hostname: name });
  }
  return out;
}

const nextConfig: NextConfig = {
  // Self-contained server bundle for Docker (`node server.js`); see Dockerfile and DEPLOYMENT.md.
  output: "standalone",
  // Pin the workspace root to this project so a stray lockfile in a parent
  // directory is not picked up as the Turbopack root.
  turbopack: {
    // (`__dirname` exists when Next loads this file; the unit tests import it as an ES module.)
    root: path.resolve(typeof __dirname === "string" ? __dirname : process.cwd()),
  },
  poweredByHeader: false,
  // Never copy local data, secrets or tests into `.next/standalone` (and so into the
  // Docker image): some server code reads files under storage/ (backups, SEO files)
  // by computed paths, which the build tracer would otherwise follow. The keys cover
  // every route ("*", "/**") and the instrumentation hook, which is not a route.
  outputFileTracingExcludes: Object.fromEntries(
    ["*", "/**", "instrumentation", "/instrumentation"].map((key) => [key, ["storage/**", ".env", ".env.*", "tests/**", "coverage/**", "scripts/**"]]),
  ),
  images: {
    // Only this site, object storage/CDN and IMAGE_HOSTS (see imageRemotePatterns).
    remotePatterns: imageRemotePatterns(),
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
      ...runnerHeaders,
    ];
  },
};

export default nextConfig;
