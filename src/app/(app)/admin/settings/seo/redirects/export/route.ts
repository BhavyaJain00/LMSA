import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { listRedirects } from "@/lib/data/seo";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { toDateKey } from "@/lib/utils";

/**
 * GET /admin/settings/seo/redirects/export — the redirects matching the
 * page's filters (`q`, `filter=broken`) as CSV. Admin only.
 */
export const dynamic = "force-dynamic";

const STATUS_LABEL = { live: "Live", hidden: "Not public", missing: "Deleted", page: "Page" } as const;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/settings/seo/redirects")}`, req.url));
  if (!isAdmin(user)) return new NextResponse("Only administrators can export redirects.", { status: 403 });

  const params = req.nextUrl.searchParams;
  const { rows } = await listRedirects({ search: params.get("q")?.slice(0, 200) ?? "", filter: params.get("filter") === "broken" ? "broken" : "all" });
  const csv = toCsv([["Old address", "New address", "Destination", "Added"], ...rows.map((r) => [r.fromPath, r.toPath, STATUS_LABEL[r.status], r.createdAt])]);
  await audit(user, "seo.redirect_export", undefined, { rows: rows.length });

  // BOM so spreadsheet apps detect UTF-8.
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="redirects-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
