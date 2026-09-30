import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { audit, auditEventsToCsv, filterAuditEvents, isAuditFilterActive, parseAuditFilter, searchParam } from "@/lib/audit";
import { isDeletedAccount } from "@/lib/legal/erase";
import { dataRequestRows, dataRequestsToCsv, parseDataRequestFilter } from "@/lib/legal/data-requests";
import { toDateKey } from "@/lib/utils";

/**
 * GET /admin/audit/export — CSV of the audit log entries matching the same
 * filters as the page (`q`, `actor`, `action`, `target`, `from`, `to`), or of
 * the data requests with `tab=requests` (`type`, `q`). Admin only; every
 * export is itself audited.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/audit")}`, req.url));
  if (!isAdmin(user)) return new NextResponse("Only administrators can export the audit log.", { status: 403 });

  const params = req.nextUrl.searchParams;
  const db = await getDb();
  let csv: string;
  let name: string;

  if (searchParam(params, "tab") === "requests") {
    const filter = parseDataRequestFilter((key) => searchParam(params, key));
    const rows = dataRequestRows(db.dataRequests, db.users, filter);
    csv = dataRequestsToCsv(rows);
    name = `data-requests-${toDateKey()}.csv`;
    await audit(user, "audit.export", undefined, { tab: "requests", rows: rows.length, type: filter.type });
  } else {
    const filter = parseAuditFilter(params);
    const actors = new Map(db.users.map((u) => [u.id, { name: u.name, email: isDeletedAccount(u) ? "" : u.email }]));
    const events = filterAuditEvents(db.auditEvents, filter, actors);
    csv = auditEventsToCsv(events, actors);
    name = `audit-log-${toDateKey()}.csv`;
    await audit(user, "audit.export", undefined, { tab: "activity", rows: events.length, filtered: isAuditFilterActive(filter) });
  }

  // BOM so spreadsheet apps detect UTF-8 (names, arrows in descriptions).
  return new NextResponse(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
