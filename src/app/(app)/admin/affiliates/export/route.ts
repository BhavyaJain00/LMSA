import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { affiliatesToCsv, commissionsToCsv, listAffiliatePayouts, listAffiliates, listCommissions, payoutsToCsv } from "@/lib/growth/affiliates";
import { parseAffiliateFilter, parseCommissionFilter } from "@/lib/growth/affiliates-shared";
import { toDateKey } from "@/lib/utils";

/**
 * GET /admin/affiliates/export?type=affiliates|commissions|payouts — CSV of
 * the affiliate programme with the same filters as the admin page.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/affiliates")}`, req.url));
  if (!isAdmin(user)) return new NextResponse("Only administrators can export affiliate data.", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  let csv: string;
  let count: number;
  if (type === "commissions") {
    const rows = await listCommissions(parseCommissionFilter(sp));
    csv = commissionsToCsv(rows);
    count = rows.length;
  } else if (type === "payouts") {
    const affiliate = sp.get("affiliate") ?? undefined;
    const rows = await listAffiliatePayouts(affiliate || undefined);
    csv = payoutsToCsv(rows);
    count = rows.length;
  } else if (type === "affiliates") {
    const rows = await listAffiliates(parseAffiliateFilter(sp));
    csv = affiliatesToCsv(rows);
    count = rows.length;
  } else {
    return new NextResponse("Unknown export type.", { status: 400 });
  }
  await audit(user, "affiliate.export", { type: "export", id: type }, { rows: count });
  // BOM so spreadsheet apps detect UTF-8 (names, currency symbols).
  return new NextResponse(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="affiliate-${type}-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
