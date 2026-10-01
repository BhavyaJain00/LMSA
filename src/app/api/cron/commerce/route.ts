import { NextResponse, type NextRequest } from "next/server";
import { verifyCronKey } from "@/lib/email";
import { runMembershipMaintenance } from "@/lib/commerce/membership-service";
import { runInstallmentMaintenance } from "@/lib/commerce/installment-service";
import { deliverDueGifts } from "@/lib/commerce/gift-service";
import { processAbandonedCheckouts } from "@/lib/commerce/checkout-sessions";

/**
 * Scheduled commerce upkeep.
 *
 *   GET or POST /api/cron/commerce?key=<cron key>
 *   (or send the key as `Authorization: Bearer <cron key>`)
 *
 * The key is the same one as for `/api/cron/emails` (derived from APP_SECRET,
 * shown to admins in Settings → Email). Each call keeps memberships current:
 * memberships paid by hand become "payment due" or end when their period runs
 * out, renewal orders are opened ahead of the period end, members are reminded
 * before a trial ends, and Stripe/Razorpay memberships whose renewal webhook
 * seems to be missing are read back from the gateway. It also keeps payment
 * plans (courses paid in installments) current: learners are reminded before
 * and after a payment falls due, told when access pauses (administrators
 * too), and Stripe plans with a charge that seems to be missing are read back.
 * Gifts scheduled for a later date are emailed to their recipients once
 * their send time has come. Checkouts that were started but not finished
 * get their reminder emails (the last one with a single-use coupon), and
 * checkouts whose purchase went through are closed.
 * The same work also runs lazily when members or administrators open the
 * membership, order and plan pages, so the schedule (hourly is plenty) only
 * makes it timely.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

async function handle(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "") : null;
  const key = bearer ?? request.nextUrl.searchParams.get("key");
  if (!verifyCronKey(key)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  try {
    const memberships = await runMembershipMaintenance({ force: true });
    const installments = await runInstallmentMaintenance({ force: true });
    const gifts = await deliverDueGifts({ force: true });
    const checkouts = await processAbandonedCheckouts({ force: true });
    return NextResponse.json({ ok: true, memberships, installments, gifts, checkouts }, { headers: NO_STORE });
  } catch (error) {
    console.error("[commerce] cron run failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: "Commerce upkeep failed" }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
