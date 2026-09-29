import { NextResponse, type NextRequest } from "next/server";
import { MAX_IMPORT_BYTES, importCourseFile } from "@/lib/actions/course-import";

/** Room for the multipart boundary and headers around the file itself. */
const MULTIPART_OVERHEAD = 64 * 1024;

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Only accept same-origin browser posts. Server Actions get this check from
 * Next.js; route handlers have to do it themselves.
 */
function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * POST /admin/courses/import/upload — multipart form with a `file` field holding
 * a course JSON export. A route handler is used instead of a Server Action
 * because action bodies are capped at 1 MB and exports are often larger.
 * Responds with `{ ok: true, redirectTo, message, tone }` or `{ ok: false, error }`.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return json({ ok: false, error: "This request was blocked. Reload the page and try again." }, 403);

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_IMPORT_BYTES + MULTIPART_OVERHEAD) return json({ ok: false, error: "This file is too large (max 5 MB)." }, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: "The upload could not be read. Please choose the file again." }, 400);
  }

  try {
    const result = await importCourseFile(form.get("file"));
    if (!result.ok) return json({ ok: false, error: result.error }, result.status);
    return json({ ok: true, redirectTo: result.redirectTo, message: result.message, tone: result.tone }, 200);
  } catch (err) {
    console.error("Course import failed", err);
    return json({ ok: false, error: "Error importing course. Please try again." }, 500);
  }
}
