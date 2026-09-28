import Link from "next/link";
import type { Role } from "@/lib/types";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { roleLabels } from "@/lib/config";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { MembersFilters } from "@/components/admin/settings/members-filters";
import { isRole } from "@/components/admin/settings/roles";
import { formatDate, formatNumber, relativeTime } from "@/lib/utils";

export const metadata = { title: "Members" };

const PAGE_SIZE = 25;
const ROLE_ORDER: Role[] = ["admin", "moderator", "course_creator", "batch_evaluator", "student"];

export default async function MembersPage(props: PageProps<"/admin/members">) {
  const viewer = await requireRole(["moderator"], "/admin/members");
  const sp = await props.searchParams;
  const search = typeof sp.search === "string" ? sp.search.trim() : "";
  const role = typeof sp.role === "string" && isRole(sp.role) ? sp.role : "all";
  const status = sp.status === "enabled" || sp.status === "disabled" ? sp.status : "all";
  const limitRaw = Number(typeof sp.limit === "string" ? sp.limit : PAGE_SIZE);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 2000) : PAGE_SIZE;

  const db = await getDb();
  const enrollmentCounts = new Map<string, number>();
  for (const e of db.enrollments) enrollmentCounts.set(e.userId, (enrollmentCounts.get(e.userId) ?? 0) + 1);

  const q = search.toLowerCase();
  const filtered = db.users
    .filter((u) => {
      if (role !== "all" && !u.roles.includes(role)) return false;
      if (status === "enabled" && !u.enabled) return false;
      if (status === "disabled" && u.enabled) return false;
      if (q && !`${u.name} ${u.email} ${u.username}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visible = filtered.slice(0, limit);

  const staffCount = db.users.filter((u) => u.roles.some((r) => r !== "student")).length;
  const disabledCount = db.users.filter((u) => !u.enabled).length;

  const moreQuery = new URLSearchParams();
  if (search) moreQuery.set("search", search);
  if (role !== "all") moreQuery.set("role", role);
  if (status !== "all") moreQuery.set("status", status);
  moreQuery.set("limit", String(limit + PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Members"
        description="Everyone with an account. Add members, manage roles and access."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Members" }]} />}
        actions={
          <>
            {isAdmin(viewer) && (
              <ButtonLink href="/admin/settings/general" variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
                Settings
              </ButtonLink>
            )}
            <ButtonLink href="/admin/members/new" leftIcon={<Icon.UserPlus className="size-4" />}>
              Add member
            </ButtonLink>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <StatCard label="Members" value={formatNumber(db.users.length)} icon={<Icon.Users className="size-5" />} />
        <StatCard label="Staff" value={formatNumber(staffCount)} hint="Any role besides student" icon={<Icon.ShieldCheck className="size-5" />} />
        <StatCard label="Disabled" value={formatNumber(disabledCount)} icon={<Icon.Lock className="size-5" />} />
      </div>

      {db.users.length === 0 ? (
        <EmptyState
          icon={<Icon.User />}
          title="No Users Found"
          description="Add one to get started."
          action={
            <ButtonLink href="/admin/members/new" leftIcon={<Icon.UserPlus className="size-4" />}>
              Add member
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-4">
          <MembersFilters values={{ search, role, status }} />
          <Table>
            <THead>
              <tr>
                <TH>User</TH>
                <TH className="hidden md:table-cell">Roles</TH>
                <TH className="hidden sm:table-cell">Enrollments</TH>
                <TH className="hidden lg:table-cell">Last active</TH>
                <TH className="hidden lg:table-cell">Joined</TH>
                <TH className="w-10">
                  <span className="sr-only">Open</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {visible.length === 0 ? (
                <TableEmpty colSpan={6}>{search ? `No members match “${search}”.` : "No members match this filter."}</TableEmpty>
              ) : (
                visible.map((u) => {
                  const roles = ROLE_ORDER.filter((r) => u.roles.includes(r));
                  return (
                    <TR key={u.id} className="relative transition-colors hover:bg-surface-2">
                      <TD>
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                          <div className="min-w-0">
                            <Link href={`/admin/members/${u.id}`} className="block truncate font-medium after:absolute after:inset-0 hover:underline">
                              {u.name}
                            </Link>
                            <p className="truncate text-xs text-ink-muted">{u.email}</p>
                            <div className="mt-1 flex flex-wrap gap-1 md:hidden">
                              {!u.enabled && (
                                <Badge tone="danger" size="xs">
                                  Disabled
                                </Badge>
                              )}
                              {roles.map((r) => (
                                <Badge key={r} size="xs" tone={r === "admin" ? "accent" : "neutral"}>
                                  {roleLabels[r]}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </TD>
                      <TD className="hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {!u.enabled && (
                            <Badge tone="danger" dot>
                              Disabled
                            </Badge>
                          )}
                          {roles.map((r) => (
                            <Badge key={r} tone={r === "admin" ? "accent" : "neutral"}>
                              {roleLabels[r]}
                            </Badge>
                          ))}
                        </div>
                      </TD>
                      <TD className="hidden tabular-nums text-ink-muted sm:table-cell">{enrollmentCounts.get(u.id) ?? 0}</TD>
                      <TD className="hidden whitespace-nowrap text-ink-muted lg:table-cell">{u.lastActiveAt ? relativeTime(u.lastActiveAt) : "Never"}</TD>
                      <TD className="hidden whitespace-nowrap text-ink-muted lg:table-cell">{formatDate(u.createdAt)}</TD>
                      <TD>
                        <Icon.ChevronRight className="size-4 text-ink-faint" />
                      </TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
            <span>
              Showing {visible.length} of {filtered.length}
            </span>
            {filtered.length > limit && (
              <ButtonLink href={`/admin/members?${moreQuery}`} variant="outline" size="sm">
                Load more
              </ButtonLink>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
