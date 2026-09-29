import Link from "next/link";
import { notFound } from "next/navigation";
import type { Role } from "@/lib/types";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { clampMinLength } from "@/lib/auth/password-policy";
import { roleLabels } from "@/lib/config";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs, DetailItem } from "@/components/admin/settings/settings-ui";
import { MemberAccountPanel, MemberProfileForm, MemberRolesForm } from "@/components/admin/settings/member-forms";
import { PaymentStatusBadge } from "@/components/commerce/transactions-table";
import { formatDate, formatPrice, pluralize, relativeTime } from "@/lib/utils";

export async function generateMetadata(props: PageProps<"/admin/members/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const user = db.users.find((u) => u.id === id);
  return { title: user ? `${user.name} · Members` : "Member" };
}

const ROLE_ORDER: Role[] = ["admin", "moderator", "course_creator", "batch_evaluator", "student"];

export default async function MemberDetailPage(props: PageProps<"/admin/members/[id]">) {
  const { id } = await props.params;
  const viewer = await requireRole(["moderator"], `/admin/members/${id}`);
  const db = await getDb();
  const member = db.users.find((u) => u.id === id);
  if (!member) notFound();

  const viewerIsAdmin = isAdmin(viewer);
  const isSelf = viewer.id === member.id;
  const memberIsAdmin = member.roles.includes("admin");
  const readOnly = memberIsAdmin && !viewerIsAdmin;
  const lockedRoles: Role[] = [];
  if (isSelf && memberIsAdmin) lockedRoles.push("admin");
  if (isSelf && !viewerIsAdmin && member.roles.includes("moderator")) lockedRoles.push("moderator");

  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const batches = new Map(db.batches.map((b) => [b.id, b]));
  const enrollments = db.enrollments
    .filter((e) => e.userId === member.id)
    .sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt))
    .map((e) => ({ ...e, course: courses.get(e.courseId) ?? null, batch: e.batchId ? (batches.get(e.batchId) ?? null) : null }));
  const batchEnrollments = db.batchEnrollments
    .filter((e) => e.userId === member.id)
    .sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt))
    .map((e) => ({ ...e, batch: batches.get(e.batchId) ?? null }));
  const payments = db.payments.filter((p) => p.userId === member.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const badgeMap = new Map(db.badges.map((b) => [b.id, b]));
  const badges = db.badgeAssignments
    .filter((a) => a.userId === member.id)
    .map((a) => ({ ...a, badge: badgeMap.get(a.badgeId) ?? null }))
    .filter((a) => a.badge);
  const certificates = db.certificates.filter((c) => c.userId === member.id);
  const completed = enrollments.filter((e) => e.completedAt).length;
  const roles = ROLE_ORDER.filter((r) => member.roles.includes(r));

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar name={member.name} src={member.avatarUrl} size="lg" />
            <span className="min-w-0">
              <span className="block truncate">{member.name}</span>
              <span className="block truncate text-sm font-normal text-ink-muted">
                {member.email} · @{member.username}
              </span>
            </span>
          </span>
        }
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Members", href: "/admin/members" },
              { label: member.name },
            ]}
          />
        }
        actions={
          <ButtonLink href={`/user/${member.username}`} variant="outline" leftIcon={<Icon.User className="size-4" />}>
            Go to Profile
          </ButtonLink>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-1.5">
        {!member.enabled && (
          <Badge tone="danger" dot>
            Disabled
          </Badge>
        )}
        {roles.map((r) => (
          <Badge key={r} tone={r === "admin" ? "accent" : "neutral"}>
            {roleLabels[r]}
          </Badge>
        ))}
        {isSelf && <Badge tone="info">You</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          <MemberProfileForm
            member={{
              id: member.id,
              name: member.name,
              email: member.email,
              username: member.username,
              headline: member.headline ?? "",
              location: member.location ?? "",
              bio: member.bio ?? "",
            }}
            canEditEmail={viewerIsAdmin}
            readOnly={readOnly}
          />
          <MemberRolesForm memberId={member.id} roles={member.roles} canGrantAdmin={viewerIsAdmin} readOnly={readOnly} lockedRoles={lockedRoles} />
          {viewerIsAdmin && (
            <MemberAccountPanel
              member={{ id: member.id, name: member.name, enabled: member.enabled }}
              isSelf={isSelf}
              minPasswordLength={clampMinLength(db.settings.security.passwordMinLength)}
            />
          )}
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <dl className="space-y-3">
              <DetailItem label="Joined">{formatDate(member.createdAt)}</DetailItem>
              <DetailItem label="Last active">{member.lastActiveAt ? relativeTime(member.lastActiveAt) : "Never"}</DetailItem>
              <DetailItem label="Courses">
                {pluralize(enrollments.length, "enrollment")} · {completed} completed
              </DetailItem>
              <DetailItem label="Batches">{pluralize(batchEnrollments.length, "batch", "batches")}</DetailItem>
              <DetailItem label="Certificates">{certificates.length}</DetailItem>
              {member.persona?.role && <DetailItem label="Persona">{[member.persona.role, member.persona.industry].filter(Boolean).join(" · ")}</DetailItem>}
            </dl>
          </Card>
          {badges.length > 0 && (
            <Card className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Badges</p>
              <ul className="mt-3 space-y-2">
                {badges.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.badge!.imageUrl} alt="" className="size-7 rounded-md bg-surface-2 object-contain p-0.5" />
                    <span className="min-w-0 flex-1 truncate">{a.badge!.title}</span>
                    <span className="text-xs text-ink-muted">{formatDate(a.issuedOn)}</span>
                  </li>
                ))}
              </ul>
              {viewerIsAdmin && (
                <Link href="/admin/settings/badges?tab=assignments" className="mt-3 inline-block text-xs font-medium text-accent hover:underline">
                  Manage badge assignments
                </Link>
              )}
            </Card>
          )}
        </aside>
      </div>

      <section className="mt-8 space-y-6">
        <Card>
          <CardHeader title="Course enrollments" description="Courses this member is enrolled in, with their progress." />
          {enrollments.length === 0 ? (
            <div className="p-5">
              <EmptyState compact icon={<Icon.BookOpen />} title="No enrollments yet" description="Courses this member joins will appear here." />
            </div>
          ) : (
            <div className="p-3 sm:p-4">
              <Table>
                <THead>
                  <tr>
                    <TH>Course</TH>
                    <TH className="w-40">Progress</TH>
                    <TH className="hidden md:table-cell">Enrolled</TH>
                    <TH className="hidden md:table-cell">Access</TH>
                  </tr>
                </THead>
                <TBody>
                  {enrollments.map((e) => (
                    <TR key={e.id}>
                      <TD>
                        {e.course ? (
                          <Link href={`/courses/${e.course.slug}`} className="font-medium hover:underline">
                            {e.course.title}
                          </Link>
                        ) : (
                          <span className="text-ink-faint">Deleted course</span>
                        )}
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {e.memberType !== "student" && <Badge size="xs">{e.memberType === "staff" ? "Staff" : "Mentor"}</Badge>}
                          {e.completedAt && (
                            <Badge size="xs" tone="success">
                              Completed {formatDate(e.completedAt)}
                            </Badge>
                          )}
                          {e.purchasedCertificate && (
                            <Badge size="xs" tone="info">
                              Certificate purchased
                            </Badge>
                          )}
                        </div>
                      </TD>
                      <TD>
                        <ProgressBar value={e.progress} size="sm" showLabel />
                      </TD>
                      <TD className="hidden whitespace-nowrap text-ink-muted md:table-cell">{formatDate(e.enrolledAt)}</TD>
                      <TD className="hidden text-ink-muted md:table-cell">{e.batch ? `Via ${e.batch.title}` : e.paymentId ? "Paid" : "Self-enrolled"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Batches" />
            {batchEnrollments.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-muted">Not part of any batch.</p>
            ) : (
              <ul className="divide-y divide-border">
                {batchEnrollments.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    {e.batch ? (
                      <Link href={`/batches/${e.batch.slug}`} className="min-w-0 truncate font-medium hover:underline">
                        {e.batch.title}
                      </Link>
                    ) : (
                      <span className="text-ink-faint">Deleted batch</span>
                    )}
                    <span className="shrink-0 text-xs text-ink-muted">{formatDate(e.enrolledAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader
              title="Payments"
              actions={
                viewerIsAdmin && payments.length > 0 ? (
                  <Link href={`/admin/settings/transactions?search=${encodeURIComponent(member.email)}`} className="text-xs font-medium text-accent hover:underline">
                    View in Transactions
                  </Link>
                ) : undefined
              }
            />
            {payments.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-muted">No orders placed.</p>
            ) : (
              <ul className="divide-y divide-border">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.itemTitle}</p>
                      <p className="font-mono text-xs text-ink-muted">
                        {p.orderId} · {formatDate(p.createdAt)}
                      </p>
                      {viewerIsAdmin && p.invoiceNumber && (
                        <Link href={`/billing/invoice/${encodeURIComponent(p.orderId)}`} className="text-xs font-medium text-accent hover:underline">
                          Invoice {p.invoiceNumber}
                        </Link>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="tabular-nums">{formatPrice(p.amount, p.currency)}</span>
                      <PaymentStatusBadge status={p.status} failureReason={p.failureReason} refundedAmount={p.refundedAmount} amount={p.amount} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {certificates.length > 0 && (
          <Card>
            <CardHeader title="Certificates" />
            <ul className="divide-y divide-border">
              {certificates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <Link href={`/certificates/${c.code}`} className="min-w-0 truncate font-medium hover:underline">
                    {courses.get(c.courseId ?? "")?.title ?? batches.get(c.batchId ?? "")?.title ?? c.code}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    {!c.published && <StatusBadge status="archived" />}
                    <span className="text-xs text-ink-muted">{formatDate(c.issueDate)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
