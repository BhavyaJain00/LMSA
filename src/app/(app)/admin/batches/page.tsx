import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getAdminBatchRows, type AdminBatchListTab } from "@/lib/data/batches";
import { formatPrice } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { AvatarGroup } from "@/components/ui/avatar";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Icon } from "@/components/ui/icons";
import { BatchStatusBadge } from "@/components/batches/batch-meta";
import { ListFilters } from "@/components/batches/list-filters";
import { formatClockRange, formatDateRange } from "@/components/batches/tz";

export const metadata: Metadata = { title: "Manage batches" };

const TABS: { value: AdminBatchListTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "unpublished", label: "Unpublished" },
];

export default async function AdminBatchesPage(props: PageProps<"/admin/batches">) {
  const user = await requireRole(["moderator", "course_creator", "batch_evaluator"], "/admin/batches");
  const [settings, sp] = await Promise.all([getSettings(), props.searchParams]);
  if (!settings.features.batches) notFound();
  const rawTab = typeof sp.tab === "string" ? sp.tab : "all";
  const tab = (TABS.some((t) => t.value === rawTab) ? rawTab : "all") as AdminBatchListTab;
  const search = typeof sp.search === "string" ? sp.search : undefined;

  const [rows, allRows] = await Promise.all([getAdminBatchRows(user, { tab, search }), getAdminBatchRows(user, { tab: "all" })]);
  const counts: Record<AdminBatchListTab, number> = {
    all: allRows.length,
    upcoming: allRows.filter((r) => r.status === "upcoming").length,
    active: allRows.filter((r) => r.status === "active").length,
    completed: allRows.filter((r) => r.status === "completed").length,
    unpublished: allRows.filter((r) => !r.published).length,
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Batches"
        description="Create cohorts, enroll students, schedule live classes and track progress."
        actions={
          <ButtonLink href="/admin/batches/new" leftIcon={<Icon.Plus className="size-4" />}>
            New Batch
          </ButtonLink>
        }
      />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Tabs items={TABS.map((t) => ({ value: t.value, label: t.label, count: counts[t.value] }))} className="lg:flex-1" />
        <ListFilters placeholder="Search batches" />
      </div>

      {rows.length === 0 ? (
        search ? (
          <EmptyState icon={<Icon.Search />} title="No batches match your search" description="Try a different title." />
        ) : (
          <EmptyState
            icon={<Icon.Users />}
            title={tab === "all" ? "No batches yet" : "No batches here"}
            description={tab === "all" ? "Create your first batch to run a cohort with live classes and a shared timetable." : "Batches in this state will be listed here."}
            action={
              <ButtonLink href="/admin/batches/new" leftIcon={<Icon.Plus className="size-4" />}>
                New Batch
              </ButtonLink>
            }
          />
        )
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Batch</TH>
              <TH>Schedule</TH>
              <TH>Students</TH>
              <TH>Status</TH>
              <TH>Price</TH>
              <TH>Instructors</TH>
              <TH className="text-right">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD>
                  <Link href={`/admin/batches/${r.id}`} className="block min-w-48 font-medium text-ink hover:text-accent">
                    {r.title}
                  </Link>
                  <span className="text-xs text-ink-muted">
                    {r.courseCount} course{r.courseCount === 1 ? "" : "s"} · /{r.slug}
                  </span>
                </TD>
                <TD className="whitespace-nowrap">
                  <span className="block">{formatDateRange(r.startDate, r.endDate)}</span>
                  <span className="text-xs text-ink-muted">
                    {formatClockRange(r.startTime, r.endTime)} · {r.timezone.replace(/_/g, " ")}
                  </span>
                </TD>
                <TD className="whitespace-nowrap">
                  <span className="font-medium">{r.studentCount}</span>
                  <span className="text-ink-muted">{r.seatCount > 0 ? ` / ${r.seatCount}` : ""}</span>
                  {r.seatsLeft === 0 && (
                    <Badge tone="danger" size="xs" className="ml-2">
                      Full
                    </Badge>
                  )}
                </TD>
                <TD>
                  <span className="flex flex-col items-start gap-1">
                    <BatchStatusBadge status={r.status} />
                    {!r.published && (
                      <Badge tone="warning" size="xs">
                        Unpublished
                      </Badge>
                    )}
                  </span>
                </TD>
                <TD className="whitespace-nowrap">{r.paidBatch && r.amount > 0 ? formatPrice(r.amount, r.currency) : <span className="text-success">Free</span>}</TD>
                <TD>
                  <AvatarGroup users={r.instructors} max={3} size="xs" />
                </TD>
                <TD className="text-right">
                  <span className="inline-flex gap-1">
                    <ButtonLink href={`/batches/${r.slug}`} variant="ghost" size="sm" aria-label={`View ${r.title}`}>
                      <Icon.Eye className="size-4" />
                    </ButtonLink>
                    <ButtonLink href={`/admin/batches/${r.id}`} variant="outline" size="sm">
                      Manage
                    </ButtonLink>
                  </span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
