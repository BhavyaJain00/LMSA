import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getAdminMembers, membersToCsv, parseMemberFilter } from "@/lib/commerce/membership-views";
import { toDateKey } from "@/lib/utils";

/**
 * GET /admin/settings/plans/export — CSV of the memberships matching the same
 * filters as the Members tab (status, plan, gateway, q), all pages.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/settings/plans?tab=members")}`, req.url));
  if (!isAdmin(user)) return new NextResponse("Only administrators can export memberships.", { status: 403 });

  const { rows } = await getAdminMembers(parseMemberFilter(req.nextUrl.searchParams), { all: true });
  // BOM so spreadsheet apps detect UTF-8 (names, currency symbols).
  const csv = `﻿${membersToCsv(rows)}`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="memberships-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
