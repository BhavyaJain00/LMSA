import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { parseTaxReportFilter, taxReport, taxReportToCsv } from "@/lib/commerce/tax-views";
import { toDateKey } from "@/lib/utils";

/**
 * GET /admin/settings/taxes/export?from=YYYY-MM-DD&to=YYYY-MM-DD&country=XX —
 * CSV of the paid orders that charged tax (all rows matching the filters of
 * the tax report), for bookkeeping and tax returns.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/settings/taxes")}`, req.url));
  if (!isAdmin(user)) return new NextResponse("Only administrators can export the tax report.", { status: 403 });

  const { lines } = taxReport(await getDb(), parseTaxReportFilter(req.nextUrl.searchParams));
  // BOM so spreadsheet apps detect UTF-8 (names, currency symbols).
  return new NextResponse(`\uFEFF${taxReportToCsv(lines)}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tax-report-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
