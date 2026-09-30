import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { cleanSegmentFilter, resolveSegment } from "@/lib/comms/audience";
import { decodeSegmentParam, describeSegment, segmentCsvRows } from "@/lib/comms/segments";
import { getDb } from "@/lib/db/store";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { toDateKey } from "@/lib/utils";

/**
 * CSV of everyone a segment reaches (`?segment=` as produced by the
 * segment builder). Moderators and admins only; every export is audited
 * because it contains personal data.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/broadcasts/audience")}`, req.url));
  if (!isModerator(user)) return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });

  const filter = await cleanSegmentFilter(decodeSegmentParam(req.nextUrl.searchParams.get("segment")));
  const [{ recipients }, db] = await Promise.all([resolveSegment(filter), getDb()]);
  const titles = new Map(db.courses.map((c) => [c.id, c.title] as const));
  await audit(user, "broadcast.audience_export", undefined, {
    recipients: recipients.length,
    segment: describeSegment(filter, (id) => titles.get(id)).join("; "),
  });

  // Leading BOM so spreadsheet apps detect UTF-8.
  const csv = "\uFEFF" + toCsv(segmentCsvRows(recipients));
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audience-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
