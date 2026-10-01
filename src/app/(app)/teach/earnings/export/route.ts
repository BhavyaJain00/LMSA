import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getInstructorEarnings } from "@/lib/teaching/marketplace";
import { earningsToCsv, parseEarningFilter, payoutsToCsv } from "@/lib/teaching/marketplace-shared";
import { toDateKey } from "@/lib/utils";

/**
 * GET /teach/earnings/export?type=earnings|payouts — the signed-in
 * instructor's own earnings (same filters as the Sales tab) or payouts as CSV.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/teach/earnings")}`, req.url));
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  if (type !== "earnings" && type !== "payouts") return new NextResponse("Unknown export type.", { status: 400 });
  const data = await getInstructorEarnings(user.id, parseEarningFilter(sp));
  if (!data) return new NextResponse("Apply to teach first.", { status: 403 });

  const csv = type === "earnings" ? earningsToCsv(data.rows, false) : payoutsToCsv(data.payouts);
  await audit(user, "marketplace.export", { type: "export", id: `own-${type}` }, { rows: type === "earnings" ? data.rows.length : data.payouts.length });
  // BOM so spreadsheet apps detect UTF-8 (course titles, currency symbols).
  return new NextResponse(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="my-${type}-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
