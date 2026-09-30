import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getAffiliateDashboard, statementToCsv } from "@/lib/growth/affiliates";
import { toDateKey } from "@/lib/utils";

/**
 * GET /affiliate/export — the signed-in affiliate's own statement as CSV:
 * every commission (refund adjustments included) followed by the payouts.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/affiliate")}`, req.url));
  const dashboard = await getAffiliateDashboard(user.id);
  if (!dashboard) return new NextResponse("Join the affiliate program to get a statement.", { status: 404 });
  // BOM so spreadsheet apps detect UTF-8 (course titles, currency symbols).
  return new NextResponse(`﻿${statementToCsv(dashboard)}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="affiliate-statement-${dashboard.affiliate.code}-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
