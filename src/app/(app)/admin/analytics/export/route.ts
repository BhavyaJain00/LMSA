import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getAnalyticsReport, isExportSection, reportToCsv } from "@/lib/growth/analytics";
import { parseRange } from "@/lib/growth/analytics-shared";

/**
 * GET /admin/analytics/export?section=<daily|funnel|revenue|landing|referrers|campaigns|coupons|affiliates|cohorts>
 * with the dashboard's period (`range` or `from`/`to`): one report section as CSV.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const url = new URL(req.url);
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/analytics")}`, url));
  if (!isAdmin(user)) return new NextResponse("Only administrators can export analytics.", { status: 403 });

  const section = url.searchParams.get("section");
  if (!isExportSection(section)) return new NextResponse("Unknown export section.", { status: 400 });
  const range = parseRange(url.searchParams);
  const report = await getAnalyticsReport(range);
  await audit(user, "analytics.export", { type: "export", id: section }, { from: range.from, to: range.to });
  // BOM so spreadsheet apps detect UTF-8 (page paths, item titles).
  return new NextResponse(`\uFEFF${reportToCsv(report, section)}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="analytics-${section}-${range.from}-to-${range.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
