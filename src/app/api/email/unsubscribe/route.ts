import { NextResponse, type NextRequest } from "next/server";
import { confirmationUrl, oneClickUnsubscribe, signedParams } from "@/lib/email/one-click";

/**
 * RFC 8058 one-click unsubscribe endpoint, referenced by the
 * `List-Unsubscribe` / `List-Unsubscribe-Post` headers of every optional email.
 *
 *   POST /api/email/unsubscribe?unsubscribe=<category>&u=<userId>&t=<signature>
 *        body: List-Unsubscribe=One-Click
 *
 * The HMAC signature authorizes the change, so no session, cookie or CSRF
 * token is involved (API routes are outside the login proxy). GET never
 * changes anything: it redirects to the confirmation page, because link
 * scanners and prefetchers open URLs on their own.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 8 * 1024;

async function formBody(request: NextRequest): Promise<URLSearchParams | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return null;
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/x-www-form-urlencoded")) return new URLSearchParams((await request.text()).slice(0, MAX_BODY_BYTES));
    if (type.includes("multipart/form-data")) {
      const data = await request.formData();
      const out = new URLSearchParams();
      for (const [key, value] of data) if (typeof value === "string") out.append(key, value);
      return out;
    }
  } catch {
    return null;
  }
  return null;
}

export async function GET(request: NextRequest) {
  return NextResponse.redirect(confirmationUrl(signedParams(request.nextUrl.searchParams)), { status: 303, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const needsBody = !query.get("u") || !query.get("t");
  const params = signedParams(query, needsBody ? await formBody(request) : null);
  const result = await oneClickUnsubscribe(params);
  return new NextResponse(result.message, { status: result.status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
}
