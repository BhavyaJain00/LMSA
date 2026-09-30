import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { listTrackingEvents, parseTrackingEventFilters, trackingEventsCsvRows } from "@/lib/comms/tracking";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { toDateKey } from "@/lib/utils";

/**
 * CSV of email opens and clicks with the same filters as the tracking page
 * (?range=&type=&q=). Moderators and admins only; audited.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/broadcasts/tracking")}`, req.url));
  if (!isModerator(user)) return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });

  const filters = parseTrackingEventFilters(Object.fromEntries(req.nextUrl.searchParams));
  const { rows } = await listTrackingEvents(filters, { all: true });
  await audit(user, "broadcast.tracking_export", undefined, { events: rows.length, rangeDays: filters.range, type: filters.type });

  // Leading BOM so spreadsheet apps detect UTF-8.
  const csv = "\uFEFF" + toCsv(trackingEventsCsvRows(rows));
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="email-tracking-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
