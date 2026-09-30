import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { findTeam, getTeamProgress, listSeats, seatsToCsv, teamProgressToCsv } from "@/lib/growth/teams";
import { orgRole, parseProgressFilter, parseSeatFilter } from "@/lib/growth/teams-shared";
import { toDateKey } from "@/lib/utils";

/**
 * GET /team/export?org=<id or slug>&type=progress|seats — CSV of a team's
 * progress (one row per member and course) or of its seat assignments, with
 * the same filters as the team dashboard. For the team's owner and managers,
 * and for administrators.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/team")}`, req.url));

  const sp = req.nextUrl.searchParams;
  const org = findTeam(await getDb(), sp.get("org"));
  // The same answer for a missing team and one the caller does not manage.
  if (!org || !(isAdmin(user) || orgRole(org, user.id))) return new NextResponse("This team does not exist, or you don't manage it.", { status: 404 });

  const type = sp.get("type");
  let csv: string;
  let rows: number;
  if (type === "seats") {
    const seats = await listSeats(org.id, parseSeatFilter(sp));
    csv = seatsToCsv(seats);
    rows = seats.length;
  } else if (type === "progress") {
    const progress = await getTeamProgress(org.id, parseProgressFilter(sp));
    if (!progress) return new NextResponse("This team does not exist, or you don't manage it.", { status: 404 });
    csv = teamProgressToCsv(progress);
    rows = progress.rows.length;
  } else {
    return new NextResponse("Unknown export type.", { status: 400 });
  }

  await audit(user, "team.export", { type: "team", id: org.id }, { export: type, rows });
  // BOM so spreadsheet apps detect UTF-8 (names, course titles).
  return new NextResponse(`﻿${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="team-${org.slug}-${type}-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
