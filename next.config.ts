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

const nextConfig: NextConfig = {
  // Pin the workspace root to this project so a stray lockfile in a parent
  // directory is not picked up as the Turbopack root.
  turbopack: {
    root: path.resolve(__dirname),
  },
  async redirects() {
    return legacyRedirects;
  },
  async headers() {
    return [
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
