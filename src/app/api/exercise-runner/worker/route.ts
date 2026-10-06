import { WORKER_SOURCE } from "@/components/assessments/js-runner-source";

/**
 * GET /api/exercise-runner/worker — the Web Worker that runs a learner's own
 * JavaScript against the exercise tests. Served from its own URL so it gets
 * its own Content Security Policy (next.config.ts `runnerHeaders`), the only
 * one that allows `new Function`; pages themselves never allow eval.
 */

export const dynamic = "force-static";

export function GET() {
  return new Response(WORKER_SOURCE, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
