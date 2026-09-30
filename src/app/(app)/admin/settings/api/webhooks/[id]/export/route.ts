import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { endpointHost } from "@/lib/webhooks/delivery";
import { deliveriesToCsv, filterDeliveries, isDeliveryFilterActive, parseDeliveryFilter } from "@/lib/webhooks/log";
import { toDateKey } from "@/lib/utils";

/**
 * GET /admin/settings/api/webhooks/{id}/export — CSV of the endpoint's
 * delivery log, with the same filters as the page (`q`, `status`, `event`,
 * `kind`). Admin only; every export is recorded in the audit log. Payloads
 * are left out (they hold member data); response bodies are included.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext<"/admin/settings/api/webhooks/[id]/export">) {
  const { id } = await context.params;
  const page = `/admin/settings/api/webhooks/${encodeURIComponent(id)}`;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(page)}`, request.url));
  if (!isAdmin(user)) return new NextResponse("Only administrators can export webhook deliveries.", { status: 403 });

  const db = await getDb();
  const endpoint = db.webhookEndpoints.find((e) => e.id === id);
  if (!endpoint) return new NextResponse("This webhook endpoint no longer exists.", { status: 404 });

  const filter = parseDeliveryFilter(request.nextUrl.searchParams);
  const deliveries = filterDeliveries(db.webhookDeliveries, endpoint.id, filter);
  const host = endpointHost(endpoint.url);
  await audit(user, "webhook.export", { type: "webhook", id: endpoint.id }, { host, rows: deliveries.length, filtered: isDeliveryFilterActive(filter) });

  const name = `webhook-deliveries-${host.replace(/[^a-z0-9.-]+/gi, "-")}-${toDateKey()}.csv`;
  // BOM so spreadsheet apps detect UTF-8.
  return new NextResponse(`﻿${deliveriesToCsv(deliveries)}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
