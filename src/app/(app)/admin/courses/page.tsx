import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getAdminCourseList, isCourseTab } from "@/lib/data/admin-courses";
import { formatDate, formatPrice, relativeTime } from "@/lib/utils";
import type { AdminCourseRow, AdminCourseTab } from "@/components/admin/courses/types";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { AvatarGroup } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Icon } from "@/components/ui/icons";
import { CourseRowActions } from "@/components/admin/courses/course-row-actions";
import { CourseThumb } from "@/components/admin/courses/course-thumb";

export const metadata = { title: "Manage Courses" };

const TAB_LABELS: Record<AdminCourseTab, string> = {
  all: "All",
  published: "Published",
  unpublished: "Unpublished",
  under_review: "Under review",
  mine: "Mine",
};

const EMPTY_COPY: Record<AdminCourseTab, { title: string; description: string }> = {
  all: { title: "No courses yet", description: "Create your first course to start building chapters and lessons." },
  published: { title: "No published courses", description: "Courses appear here once they are approved and published." },
  unpublished: { title: "No unpublished courses", description: "Drafts and courses taken offline appear here." },
  under_review: { title: "Nothing waiting for review", description: "Courses submitted for review by instructors appear here." },
  mine: { title: "You haven't created any courses", description: "Courses you create or teach appear here." },
};

function PublishState({ row }: { row: AdminCourseRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {row.published ? (
        <Badge tone="success" dot>
          Published
        </Badge>
      ) : (
        <Badge tone="neutral" dot>
          Draft
        </Badge>
      )}
      <StatusBadge status={row.status} />
      {row.upcoming && <Badge tone="info">Upcoming</Badge>}
      {row.featured && (
        <Badge tone="warning">
          <Icon.StarFilled className="size-3" /> Featured
        </Badge>
      )}
    </div>
  );
}

function priceLabel(row: AdminCourseRow) {
  return row.paidCourse ? formatPrice(row.price, row.currency) : "Free";
}

export default async function AdminCoursesPage(props: PageProps<"/admin/courses">) {
  const user = await requireRole(["course_creator", "moderator"], "/admin/courses");
  const sp = await props.searchParams;
  const tab: AdminCourseTab = isCourseTab(sp.tab) ? sp.tab : "all";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const { rows, counts } = await getAdminCourseList(user, { tab, search: q });

  return (
    <div>
      <PageHeader
        title="Courses"
        description="Create courses, build their outline, review submissions and follow learner progress."
        actions={
          <>
            <ButtonLink href="/admin/courses/import" variant="outline" leftIcon={<Icon.Upload className="size-4" />}>
              Import
            </ButtonLink>
            <ButtonLink href="/admin/courses/new" leftIcon={<Icon.Plus className="size-4" />}>
              New course
            </ButtonLink>
          </>
        }
      />

      <Tabs items={(Object.keys(TAB_LABELS) as AdminCourseTab[]).map((t) => ({ value: t, label: TAB_LABELS[t], count: counts[t] }))} />

      <form method="get" role="search" className="mt-4 flex max-w-lg gap-2">
        {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
        <div className="flex-1">
          <Input type="search" name="q" defaultValue={q} placeholder="Search by title, tag or instructor" aria-label="Search courses" leftAddon={<Icon.Search className="size-4" />} />
        </div>
        <button type="submit" className="h-9.5 rounded-lg border border-border-strong bg-surface-1 px-4 text-sm font-medium text-ink hover:bg-surface-2">
          Search
        </button>
      </form>
      {q && (
        <p className="mt-2 text-sm text-ink-muted">
          {rows.length} {rows.length === 1 ? "result" : "results"} for “{q}” ·{" "}
          <Link href={tab === "all" ? "/admin/courses" : `/admin/courses?tab=${tab}`} className="font-medium text-accent hover:underline">
            Clear search
          </Link>
        </p>
      )}

      <div className="mt-4">
        {rows.length === 0 ? (
          q ? (
            <EmptyState icon={<Icon.Search />} title={`No courses match “${q}”`} description="Try a different title, tag or instructor name." />
          ) : (
            <EmptyState
              icon={<Icon.BookOpen />}
              title={EMPTY_COPY[tab].title}
              description={EMPTY_COPY[tab].description}
              action={
                tab === "all" || tab === "mine" ? (
                  <ButtonLink href="/admin/courses/new" leftIcon={<Icon.Plus className="size-4" />}>
                    Create a course
                  </ButtonLink>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            {/* Mobile: cards */}
            <ul className="space-y-3 md:hidden">
              {rows.map((row) => (
                <li key={row.id} className="rounded-card border border-border bg-surface-1 p-3 shadow-card">
                  <div className="flex gap-3">
                    <CourseThumb title={row.title} imageUrl={row.imageUrl} gradient={row.cardGradient} className="w-24" />
                    <div className="min-w-0 flex-1">
                      {row.workflow.canEdit ? (
                        <Link href={`/admin/courses/${row.id}`} className="line-clamp-2 font-semibold text-ink hover:underline">
                          {row.title}
                        </Link>
                      ) : (
                        <Link href={`/courses/${row.slug}`} className="line-clamp-2 font-semibold text-ink hover:underline">
                          {row.title}
                        </Link>
                      )}
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {row.lessonCount} lessons · {row.enrollmentCount} students · {priceLabel(row)}
                      </p>
                    </div>
                    <CourseRowActions id={row.id} slug={row.slug} title={row.title} workflow={row.workflow} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <PublishState row={row} />
                    <span className="shrink-0 text-xs text-ink-faint">{relativeTime(row.updatedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>Course</TH>
                    <TH>Status</TH>
                    <TH className="hidden lg:table-cell">Instructors</TH>
                    <TH className="text-right">Lessons</TH>
                    <TH className="text-right">Students</TH>
                    <TH className="hidden xl:table-cell">Price</TH>
                    <TH className="hidden lg:table-cell">Updated</TH>
                    <TH>
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <TR key={row.id} className="hover:bg-surface-2/50">
                      <TD className="max-w-md">
                        <div className="flex items-center gap-3">
                          <CourseThumb title={row.title} imageUrl={row.imageUrl} gradient={row.cardGradient} className="w-20" />
                          <div className="min-w-0">
                            {row.workflow.canEdit ? (
                              <Link href={`/admin/courses/${row.id}`} className="line-clamp-1 font-medium text-ink hover:underline">
                                {row.title}
                              </Link>
                            ) : (
                              <Link href={`/courses/${row.slug}`} className="line-clamp-1 font-medium text-ink hover:underline">
                                {row.title}
                              </Link>
                            )}
                            <p className="line-clamp-1 text-xs text-ink-muted">
                              {row.category ?? "Uncategorized"} · /courses/{row.slug}
                            </p>
                          </div>
                        </div>
                      </TD>
                      <TD>
                        <PublishState row={row} />
                      </TD>
                      <TD className="hidden lg:table-cell">
                        {row.instructors.length ? (
                          <div className="flex items-center gap-2">
                            <AvatarGroup users={row.instructors} max={3} size="xs" />
                            <span className="max-w-32 truncate text-xs text-ink-muted">{row.instructors.length === 1 ? row.instructors[0]!.name : `${row.instructors[0]!.name} +${row.instructors.length - 1}`}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-ink-faint">—</span>
                        )}
                      </TD>
                      <TD className="text-right tabular-nums">{row.lessonCount}</TD>
                      <TD className="text-right tabular-nums">{row.enrollmentCount}</TD>
                      <TD className="hidden whitespace-nowrap xl:table-cell">{priceLabel(row)}</TD>
                      <TD className="hidden whitespace-nowrap text-ink-muted lg:table-cell" title={formatDate(row.updatedAt)}>
                        {relativeTime(row.updatedAt)}
                      </TD>
                      <TD className="w-12 text-right">
                        <CourseRowActions id={row.id} slug={row.slug} title={row.title} workflow={row.workflow} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
