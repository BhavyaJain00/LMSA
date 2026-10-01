import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getAdminMembers, membersToCsv, parseMemberFilter } from "@/lib/commerce/membership-views";
import { bundlesToCsv, getAdminBundles, parseAdminBundleFilter } from "@/lib/commerce/bundle-views";
import { getAdminInstallments, installmentsToCsv, parseInstallmentFilter } from "@/lib/commerce/installment-views";
import { getAdminGifts, giftsToCsv, parseAdminGiftFilter } from "@/lib/commerce/gift-service";
import { toDateKey } from "@/lib/utils";

type ExportTab = "members" | "bundles" | "installments" | "gifts";

const LABELS: Record<ExportTab, string> = { members: "memberships", bundles: "bundles", installments: "payment plans", gifts: "gifts" };

async function csvFor(tab: ExportTab, sp: URLSearchParams): Promise<string> {
  if (tab === "bundles") return bundlesToCsv((await getAdminBundles(parseAdminBundleFilter(sp), { all: true })).rows);
  if (tab === "installments") return installmentsToCsv((await getAdminInstallments(parseInstallmentFilter(sp), { all: true })).rows);
  if (tab === "gifts") return giftsToCsv((await getAdminGifts(parseAdminGiftFilter(sp), { all: true })).rows);
  return membersToCsv((await getAdminMembers(parseMemberFilter(sp), { all: true })).rows);
}

/**
 * GET /admin/settings/plans/export?tab=members|bundles|installments|gifts — CSV of
 * the rows matching the same filters as that tab of Plans & bundles, all
 * pages (members: status, plan, gateway, q; bundles: bstatus, bq;
 * installments: istatus, icourse, iq; gifts: gstatus, gq).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const raw = sp.get("tab");
  const tab: ExportTab = raw === "bundles" || raw === "installments" || raw === "gifts" ? raw : "members";
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/admin/settings/plans?tab=${tab}`)}`, req.url));
  if (!isAdmin(user)) return new NextResponse(`Only administrators can export ${LABELS[tab]}.`, { status: 403 });

  // BOM so spreadsheet apps detect UTF-8 (names, currency symbols).
  const csv = `﻿${await csvFor(tab, sp)}`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${LABELS[tab].replace(" ", "-")}-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
