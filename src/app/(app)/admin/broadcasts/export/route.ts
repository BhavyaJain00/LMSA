import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { broadcastCsvRows, parseBroadcastFilters } from "@/lib/comms/broadcast-core";
import { listBroadcasts } from "@/lib/comms/broadcasts";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { toDateKey } from "@/lib/utils";

/**
 * CSV of the broadcasts matching the list's filters (`?status=&q=`) with
 * their delivery, open, click and unsubscribe numbers. Moderators and admins.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/broadcasts")}`, req.url));
  if (!isModerator(user)) return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });

  const filters = parseBroadcastFilters(Object.fromEntries(req.nextUrl.searchParams));
  const list = await listBroadcasts(filters, { all: true });
  const authors = new Map(list.rows.map((row) => [row.broadcast.createdById, row.authorName] as const));
  await audit(user, "broadcast.export", undefined, { broadcasts: list.rows.length, status: filters.status, search: filters.q });

  // Leading BOM so spreadsheet apps detect UTF-8.
  const csv =
    "﻿" +
    toCsv(
      broadcastCsvRows(
        list.rows.map((row) => row.broadcast),
        (userId) => authors.get(userId) ?? "Former member",
      ),
    );
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="broadcasts-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
