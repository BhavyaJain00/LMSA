import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getAdminUpsells, parseAdminUpsellFilter, upsellsToCsv } from "@/lib/commerce/upsell-service";
import { toDateKey } from "@/lib/utils";

/** GET /admin/upsells/export?status=&q= — CSV of the upsells matching the list filters, with their results. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/upsells")}`, req.url));
  if (!isAdmin(user)) return new NextResponse("Only administrators can export upsells.", { status: 403 });
  const { rows } = await getAdminUpsells(parseAdminUpsellFilter(req.nextUrl.searchParams), { all: true });
  // BOM so spreadsheet apps detect UTF-8.
  return new NextResponse(`\uFEFF${upsellsToCsv(rows)}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="upsells-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
