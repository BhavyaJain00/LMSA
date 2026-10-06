import { ISOLATED_DOCUMENT } from "@/components/assessments/js-runner-source";

/**
 * GET /api/exercise-runner/frame — the document the exercise runner loads into
 * a `sandbox="allow-scripts"` frame (opaque origin, no cookies) to run code
 * the viewer did not write, such as a submission under review. Its own
 * Content Security Policy (next.config.ts `runnerHeaders`) allows the Blob
 * workers it creates to evaluate that code; pages themselves never allow eval.
 */

export const dynamic = "force-static";

export function GET() {
  return new Response(ISOLATED_DOCUMENT, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
