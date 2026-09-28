import { NextResponse, type NextRequest } from "next/server";
import { createSession } from "@/lib/auth/session";
import { findById } from "@/lib/db/store";

/**
 * Development-only helper for automated smoke tests: `GET /api/dev/login?as=usr_alex`
 * creates a session for the given demo user. Enabled only when
 * `LL_DEV_LOGIN=1` and never in production.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.LL_DEV_LOGIN !== "1") {
    return new NextResponse("Not found", { status: 404 });
  }
  const id = req.nextUrl.searchParams.get("as") ?? "";
  const user = await findById("users", id);
  if (!user) return NextResponse.json({ ok: false, error: "Unknown user id" }, { status: 404 });
  await createSession(user.id);
  return NextResponse.json({ ok: true, user: { id: user.id, name: user.name, roles: user.roles } });
}
