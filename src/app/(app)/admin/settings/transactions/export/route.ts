import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getTransactions, parseTransactionFilter, transactionsToCsv } from "@/lib/data/commerce";
import { toDateKey } from "@/lib/utils";

/**
 * GET /admin/settings/transactions/export — CSV of the transactions matching
 * the same filters as the Transactions page (status, type, from, to, search).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/settings/transactions")}`, req.url));
  if (!isAdmin(user)) return new NextResponse("Only administrators can export transactions.", { status: 403 });

  const filter = parseTransactionFilter(req.nextUrl.searchParams);
  const rows = await getTransactions(filter);
  // BOM so spreadsheet apps detect UTF-8 (names, currency symbols).
  const csv = `﻿${transactionsToCsv(rows)}`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
