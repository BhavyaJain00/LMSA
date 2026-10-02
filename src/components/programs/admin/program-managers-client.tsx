"use client";

import Link from "next/link";
import { useState } from "react";
import { addProgramCourseAction, addProgramMemberAction, moveProgramCourseAction, removeProgramCourseAction, removeProgramMemberAction } from "@/lib/actions/programs";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useServerAction } from "@/components/batches/hooks";
import { GroupedSelect } from "@/components/batches/admin/form-fields";
import type { Option } from "@/components/batches/types";
import type { AdminProgramCourse, ProgramMemberView, ProgramPaidCourse } from "../types";
import { GrantPaidAccessField, useEnrollmentToast } from "./grant-paid-access";
import { useFormatter, useT } from "@/i18n/client";

/* Rendered through `./program-managers.tsx`, which provides the `programsAdmin.` messages on the admin pages. */

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

export function ProgramCoursesManager({
  programId,
  courses,
  options,
  enforceOrder,
  paidCourses,
  memberCount,
}: {
  programId: string;
  courses: AdminProgramCourse[];
  options: Option[];
  enforceOrder: boolean;
  /** Paid courses among the options (see "Grant access without payment"). */
  paidCourses: ProgramPaidCourse[];
  memberCount: number;
}) {
  const t = useT("public");
  const common = useT("common");
  const [adding, setAdding] = useState(false);
  const [courseId, setCourseId] = useState("");
  const [grant, setGrant] = useState(false);
  const [removing, setRemoving] = useState<AdminProgramCourse | null>(null);
  const add = useServerAction();
  const mutate = useServerAction();
  const enrollmentToast = useEnrollmentToast();
  // Without an enforced order, adding a course enrolls the current members in it.
  const selectedPaid = !enforceOrder && memberCount > 0 ? paidCourses.filter((c) => c.id === courseId) : [];
  const closeAdd = () => {
    setAdding(false);
    setGrant(false);
  };

  return (
    <Card>
      <CardHeader
        title={t("programsAdmin.courses.title")}
        description={enforceOrder ? t("programsAdmin.courses.ordered") : t("programsAdmin.courses.recommended")}
        actions={
          <Button size="sm" onClick={() => setAdding(true)} leftIcon={<Icon.Plus className="size-4" />}>
            {common("actions.add")}
          </Button>
        }
      />
      <CardBody className="p-0">
        {courses.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">{t("programsAdmin.courses.empty")}</p>
        ) : (
          <ol className="divide-y divide-border">
            {courses.map((c, i) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-muted">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <Link href={`/courses/${c.slug}`} className="block truncate font-medium text-ink hover:text-accent">
                    {c.title}
                  </Link>
                  <p className="text-xs text-ink-muted">
                    {t("programsAdmin.courses.lessonCount", { count: c.lessonCount })}
                    {!c.published && (
                      <Badge tone="warning" size="xs" className="ms-2">
                        {t("programsAdmin.courses.unpublished")}
                      </Badge>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconButton label={t("programsAdmin.courses.moveUp")} size="icon-sm" disabled={i === 0 || mutate.pending} onClick={() => mutate.run(() => moveProgramCourseAction(programId, c.id, "up"))}>
                    <Icon.ChevronUp className="size-4" />
                  </IconButton>
                  <IconButton label={t("programsAdmin.courses.moveDown")} size="icon-sm" disabled={i === courses.length - 1 || mutate.pending} onClick={() => mutate.run(() => moveProgramCourseAction(programId, c.id, "down"))}>
                    <Icon.ChevronDown className="size-4" />
                  </IconButton>
                  <IconButton label={t("programsAdmin.remove", { name: c.title })} size="icon-sm" onClick={() => setRemoving(c)} className="hover:text-danger">
                    <Icon.Trash className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardBody>

      <Dialog
        open={adding}
        onClose={closeAdd}
        title={t("programsAdmin.courses.addTitle")}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={closeAdd} disabled={add.pending}>
              {common("actions.cancel")}
            </Button>
            <Button
              loading={add.pending}
              disabled={!courseId}
              onClick={() =>
                add.run(() => addProgramCourseAction(programId, courseId, { grantPaidAccess: grant && selectedPaid.some((c) => c.grantable) }), {
                  toast: false,
                  onSuccess: (report, message) => {
                    enrollmentToast(message, report);
                    setCourseId("");
                    closeAdd();
                  },
                })
              }
            >
              {common("actions.add")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t("programsAdmin.courses.course")} htmlFor="program-add-course">
            <GroupedSelect
              id="program-add-course"
              value={courseId}
              onChange={(value) => {
                setCourseId(value);
                setGrant(false);
              }}
              options={options}
              placeholder={options.length ? t("programsAdmin.courses.select") : t("programsAdmin.courses.allAdded")}
              disabled={!options.length}
            />
          </Field>
          <GrantPaidAccessField id="program-course-grant" courses={selectedPaid} checked={grant} onChange={setGrant} />
        </div>
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) mutate.run(() => removeProgramCourseAction(programId, removing.id), { onSuccess: () => setRemoving(null) });
        }}
        loading={mutate.pending}
        destructive
        title={removing ? t("programsAdmin.courses.removeTitle", { title: removing.title }) : t("programsAdmin.courses.removeTitleFallback")}
        description={t("programsAdmin.courses.removeDescription")}
        confirmLabel={common("actions.remove")}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Progress summary                                                    */
/* ------------------------------------------------------------------ */

const BUCKETS = [
  { label: "0–20%", min: 0, max: 20 },
  { label: "20–40%", min: 20, max: 40 },
  { label: "40–60%", min: 40, max: 60 },
  { label: "60–80%", min: 60, max: 80 },
  { label: "80–100%", min: 80, max: 101 },
];

/** Enrollments, average progress, a progress distribution histogram and a searchable member table. */
export function ProgressSummaryDialog({ open, onClose, title, members }: { open: boolean; onClose: () => void; title: string; members: ProgramMemberView[] }) {
  const t = useT("public");
  const [query, setQuery] = useState("");
  const avg = members.length ? Math.round(members.reduce((a, m) => a + m.progress, 0) / members.length) : 0;
  const counts = BUCKETS.map((b) => members.filter((m) => m.progress >= b.min && m.progress < b.max).length);
  const max = Math.max(1, ...counts);
  const q = query.trim().toLowerCase();
  const rows = members.filter((m) => !q || m.user.name.toLowerCase().includes(q));

  return (
    <Dialog open={open} onClose={onClose} title={t("programsAdmin.summary.title", { title })} size="lg">
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label={t("programsAdmin.summary.enrollments")} value={members.length} icon={<Icon.Users className="size-4" />} />
          <StatCard label={t("programsAdmin.summary.average")} value={t("programsAdmin.percent", { percent: avg })} icon={<Icon.TrendingUp className="size-4" />} />
        </div>
        <figure className="rounded-card border border-border p-4">
          <figcaption className="mb-4 flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-ink">{t("programsAdmin.summary.distribution")}</span>
            <span className="text-xs text-ink-muted">{t("programsAdmin.summary.distributionHint")}</span>
          </figcaption>
          <div className="flex h-40 items-end gap-2 sm:gap-4" role="list" aria-label={t("programsAdmin.summary.distribution")}>
            {BUCKETS.map((b, i) => (
              <div key={b.label} role="listitem" className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={t("programsAdmin.summary.bucket", { range: b.label, count: counts[i] ?? 0 })}>
                <span className="text-xs font-semibold tabular-nums text-ink">{counts[i]}</span>
                <div className="w-full max-w-14 rounded-t-[4px] bg-accent transition-[height] duration-500" style={{ height: `${(counts[i]! / max) * 100}%`, minHeight: counts[i] ? 4 : 0 }} />
                <span className="text-[11px] text-ink-muted">{b.label}</span>
              </div>
            ))}
          </div>
        </figure>
        <div className="space-y-3">
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("programsAdmin.search")} aria-label={t("programsAdmin.members.search")} leftAddon={<Icon.Search className="size-4" />} />
          <Table>
            <THead>
              <tr>
                <TH className="w-1/2">{t("programsAdmin.members.member")}</TH>
                <TH>{t("programsAdmin.summary.progressColumn")}</TH>
              </tr>
            </THead>
            <TBody>
              {rows.length === 0 && <TableEmpty colSpan={2}>{t("programsAdmin.members.noneFound")}</TableEmpty>}
              {rows.map((m) => (
                <TR key={m.id}>
                  <TD>{m.user.name}</TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <ProgressBar value={m.progress} size="xs" className="w-24" tone={m.progress >= 100 ? "success" : "accent"} label={t("programsAdmin.members.progressOf", { name: m.user.name })} />
                      <span className="tabular-nums text-ink-muted">{t("programsAdmin.percent", { percent: m.progress })}</span>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

export function ProgramMembersManager({
  programId,
  programTitle,
  members,
  candidates,
  startingPaidCourses,
}: {
  programId: string;
  programTitle: string;
  members: ProgramMemberView[];
  candidates: Option[];
  /** Paid courses a new member is enrolled in (the first course, or all when the order isn't enforced). */
  startingPaidCourses: ProgramPaidCourse[];
}) {
  const t = useT("public");
  const common = useT("common");
  const f = useFormatter();
  const [adding, setAdding] = useState(false);
  const [summary, setSummary] = useState(false);
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState("");
  const [grant, setGrant] = useState(false);
  const [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<ProgramMemberView | null>(null);
  const add = useServerAction();
  const remove = useServerAction();
  const enrollmentToast = useEnrollmentToast();
  const closeAdd = () => {
    setAdding(false);
    setGrant(false);
  };
  const q = query.trim().toLowerCase();
  const rows = members.filter((m) => !q || `${m.user.name} ${m.user.email}`.toLowerCase().includes(q));
  const s = search.trim().toLowerCase();
  const filteredCandidates = candidates.filter((c) => !s || `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(s)).slice(0, 100);

  return (
    <Card>
      <CardHeader
        title={t("programsAdmin.members.title")}
        description={t("programsAdmin.members.enrolled", { count: members.length })}
        actions={
          <>
            {members.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setSummary(true)} leftIcon={<Icon.TrendingUp className="size-4" />}>
                <span className="hidden sm:inline">{t("programsAdmin.members.summary")}</span>
                <span className="sm:hidden">{t("programsAdmin.members.summaryShort")}</span>
              </Button>
            )}
            <Button size="sm" onClick={() => setAdding(true)} leftIcon={<Icon.UserPlus className="size-4" />}>
              {common("actions.add")}
            </Button>
          </>
        }
      />
      <CardBody className="space-y-3">
        {members.length === 0 ? (
          <EmptyState icon={<Icon.Users />} title={t("programsAdmin.members.emptyTitle")} description={t("programsAdmin.members.emptyDescription")} compact />
        ) : (
          <>
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("programsAdmin.members.search")} aria-label={t("programsAdmin.members.search")} leftAddon={<Icon.Search className="size-4" />} className="sm:max-w-xs" />
            <Table>
              <THead>
                <tr>
                  <TH>{t("programsAdmin.members.member")}</TH>
                  <TH>{t("programsAdmin.members.progress")}</TH>
                  <TH>{t("programsAdmin.members.coursesDone")}</TH>
                  <TH>{t("programsAdmin.members.joined")}</TH>
                  <TH className="text-end">
                    <span className="sr-only">{t("programsAdmin.members.actions")}</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {rows.length === 0 && <TableEmpty colSpan={5}>{t("programsAdmin.members.noneFound")}</TableEmpty>}
                {rows.map((m) => (
                  <TR key={m.id}>
                    <TD>
                      <span className="flex min-w-44 items-center gap-2.5">
                        <Avatar name={m.user.name} src={m.user.avatarUrl} size="sm" />
                        <span className="min-w-0">
                          <Link href={`/user/${m.user.username}`} className="block truncate font-medium hover:text-accent">
                            {m.user.name}
                          </Link>
                          <span className="block truncate text-xs text-ink-muted">{m.user.email}</span>
                        </span>
                      </span>
                    </TD>
                    <TD>
                      <div className="flex min-w-32 items-center gap-2">
                        <ProgressBar value={m.progress} size="xs" className="w-20" tone={m.progress >= 100 ? "success" : "accent"} label={t("programsAdmin.members.progressOf", { name: m.user.name })} />
                        <span className="text-xs tabular-nums text-ink-muted">{t("programsAdmin.percent", { percent: m.progress })}</span>
                      </div>
                    </TD>
                    <TD className="text-ink-muted" title={m.courses.map((c) => t("programsAdmin.members.courseProgress", { title: c.title, percent: c.progress })).join("\n")}>
                      {t("programsAdmin.members.done", { done: m.completedCourses, total: m.courses.length })}
                    </TD>
                    <TD className="whitespace-nowrap text-ink-muted">{f.date(m.joinedAt)}</TD>
                    <TD className="text-end">
                      <IconButton label={t("programsAdmin.remove", { name: m.user.name })} size="icon-sm" onClick={() => setRemoving(m)} className="hover:text-danger">
                        <Icon.Trash className="size-4" />
                      </IconButton>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </>
        )}
      </CardBody>

      <Dialog
        open={adding}
        onClose={closeAdd}
        title={t("programsAdmin.members.addTitle")}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={closeAdd} disabled={add.pending}>
              {common("actions.cancel")}
            </Button>
            <Button
              loading={add.pending}
              disabled={!pick}
              onClick={() =>
                add.run(() => addProgramMemberAction(programId, pick, { grantPaidAccess: grant && startingPaidCourses.some((c) => c.grantable) }), {
                  toast: false,
                  onSuccess: (report, message) => {
                    enrollmentToast(message, report);
                    setPick("");
                    closeAdd();
                  },
                })
              }
            >
              {common("actions.add")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("programsAdmin.members.field")} hint={t("programsAdmin.members.fieldHint")}>
            <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("programsAdmin.members.searchUsersPlaceholder")} leftAddon={<Icon.Search className="size-4" />} aria-label={t("programsAdmin.members.searchUsers")} />
          </Field>
          <ul className="scrollbar-thin max-h-64 overflow-y-auto rounded-lg border border-border" role="listbox" aria-label={t("programsAdmin.members.users")}>
            {filteredCandidates.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-muted">{candidates.length ? t("programsAdmin.members.noMatch") : t("programsAdmin.members.everyone")}</li>}
            {filteredCandidates.map((c) => (
              <li key={c.value} role="option" aria-selected={pick === c.value}>
                <button type="button" onClick={() => setPick(c.value)} className={cn("flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-surface-2", pick === c.value && "bg-accent/10")}>
                  <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", pick === c.value ? "border-accent bg-accent" : "border-border-strong")}>
                    {pick === c.value && <span className="size-1.5 rounded-full bg-accent-fg" />}
                  </span>
                  <Avatar name={c.label} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{c.label}</span>
                    <span className="block truncate text-xs text-ink-muted">{c.hint}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <GrantPaidAccessField id="program-member-grant" courses={startingPaidCourses} checked={grant} onChange={setGrant} single />
        </div>
      </Dialog>
      <ProgressSummaryDialog open={summary} onClose={() => setSummary(false)} title={programTitle} members={members} />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.run(() => removeProgramMemberAction(programId, removing.userId), { onSuccess: () => setRemoving(null) });
        }}
        loading={remove.pending}
        destructive
        title={removing ? t("programsAdmin.members.removeTitle", { name: removing.user.name }) : t("programsAdmin.members.removeTitleFallback")}
        description={t("programsAdmin.members.removeDescription")}
        confirmLabel={common("actions.remove")}
      />
    </Card>
  );
}
