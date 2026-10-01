import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { listEarnings, listInstructorPayouts } from "@/lib/teaching/marketplace";
import { earningsToCsv, parseEarningFilter, payoutsToCsv } from "@/lib/teaching/marketplace-shared";
import { toDateKey } from "@/lib/utils";

/**
 * GET /admin/marketplace/export?type=earnings|payouts — every instructor's
 * earnings (same filters as the Earnings tab) or payouts (optionally one
 * instructor's, `instructor=<user id>`) as CSV. Administrators only.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/marketplace")}`, req.url));
  if (!isAdmin(user)) return new NextResponse("Only administrators can export marketplace data.", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  let csv: string;
  let count: number;
  if (type === "earnings") {
    const rows = await listEarnings(parseEarningFilter(sp));
    csv = earningsToCsv(rows, true);
    count = rows.length;
  } else if (type === "payouts") {
    const instructor = parseEarningFilter(sp).instructorId;
    const rows = await listInstructorPayouts(instructor || undefined);
    csv = payoutsToCsv(rows);
    count = rows.length;
  } else {
    return new NextResponse("Unknown export type.", { status: 400 });
  }
  await audit(user, "marketplace.export", { type: "export", id: type }, { rows: count });
  return new NextResponse(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="instructor-${type}-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
