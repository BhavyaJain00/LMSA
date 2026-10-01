import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { courseTitleMap, getAdminLeads } from "@/lib/seo/lead-capture";
import { type LeadStatus, leadCsvRows } from "@/lib/seo/leads";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { toDateKey } from "@/lib/utils";

/**
 * GET /admin/leads/export — the leads matching the list's filters (`status`,
 * `q`, `source`, `course`, `from`, `to`) as CSV. Admins only: leads are
 * personal data, so every export is written to the audit log.
 */
export const dynamic = "force-dynamic";

const STATUSES = new Set<LeadStatus | "all">(["all", "confirmed", "pending", "unsubscribed"]);

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/leads")}`, req.url));
  if (!isAdmin(user)) return new NextResponse("Only administrators can export leads.", { status: 403 });

  const params = req.nextUrl.searchParams;
  const status = params.get("status") as LeadStatus | "all" | null;
  const date = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);
  const [{ rows }, titles] = await Promise.all([
    getAdminLeads({
      status: status && STATUSES.has(status) ? status : "all",
      search: params.get("q")?.slice(0, 200) ?? "",
      source: params.get("source")?.slice(0, 80) || undefined,
      courseId: params.get("course")?.slice(0, 80) || undefined,
      from: date(params.get("from")),
      to: date(params.get("to")),
      pageSize: Number.MAX_SAFE_INTEGER,
    }),
    courseTitleMap(),
  ]);
  const csv = toCsv(leadCsvRows(rows, titles));
  await audit(user, "leads.export", undefined, { rows: rows.length });

  // BOM so spreadsheet apps detect UTF-8.
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
