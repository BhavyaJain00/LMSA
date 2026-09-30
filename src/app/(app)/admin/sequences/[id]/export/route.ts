import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { enrollmentCsvRows, parseEnrollmentFilters } from "@/lib/comms/sequence-core";
import { getSequence, listSequenceEnrollments } from "@/lib/comms/sequences";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { slugify, toDateKey } from "@/lib/utils";

/**
 * CSV of the people in a sequence, matching the page's filters
 * (`?status=&q=`). Moderators and admins only; every export is audited
 * because it contains personal data.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/admin/sequences/[id]/export">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/admin/sequences/${id}`)}`, req.url));
  if (!isModerator(user)) return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });

  const sequence = await getSequence(id);
  if (!sequence) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const filters = parseEnrollmentFilters(Object.fromEntries(req.nextUrl.searchParams));
  const people = await listSequenceEnrollments(sequence.id, filters, { all: true });
  await audit(user, "sequence.export", { type: "sequence", id: sequence.id }, { name: sequence.name, people: people.rows.length, status: filters.status });

  // Leading BOM so spreadsheet apps detect UTF-8.
  const csv = "﻿" + toCsv(enrollmentCsvRows(people.rows, sequence.steps));
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sequence-${slugify(sequence.name) || "people"}-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
