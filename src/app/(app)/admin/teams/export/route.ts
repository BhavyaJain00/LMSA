import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { listTeams, teamsToCsv } from "@/lib/growth/teams";
import { parseTeamFilter } from "@/lib/growth/teams-shared";
import { toDateKey } from "@/lib/utils";

/** GET /admin/teams/export — CSV of every team matching the admin page's filters (seats, usage, paid amounts). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/teams")}`, req.url));
  if (!isAdmin(user)) return new NextResponse("Only administrators can export teams.", { status: 403 });

  const rows = await listTeams(parseTeamFilter(req.nextUrl.searchParams));
  await audit(user, "team.export", { type: "export", id: "teams" }, { rows: rows.length });
  // BOM so spreadsheet apps detect UTF-8 (team and owner names).
  return new NextResponse(`﻿${teamsToCsv(rows)}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="teams-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
