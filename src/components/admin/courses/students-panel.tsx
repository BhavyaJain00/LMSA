"use client";

import { useState, useTransition } from "react";
import { removeStudentAction } from "@/lib/actions/courses";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Input, Select } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import type { DashboardStudent, LessonCompletionStat } from "./types";
import { EnrollStudentDialog } from "./enroll-student-dialog";
import { StudentProgressDialog } from "./student-progress-dialog";

const PAGE_SIZE = 50;

/** "Enroll a student" button + dialog, usable from the tab header and empty states. */
export function EnrollStudentButton({ courseId, paidCertificate, variant = "primary" }: { courseId: string; paidCertificate: boolean; variant?: "primary" | "outline" }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <Button
        variant={variant}
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
        leftIcon={<Icon.UserPlus className="size-4" />}
      >
        Enroll a student
      </Button>
      <EnrollStudentDialog key={key} open={open} onClose={() => setOpen(false)} courseId={courseId} paidCertificate={paidCertificate} />
    </>
  );
}

export function StudentsPanel({ courseId, students }: { courseId: string; students: DashboardStudent[] }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | "student" | "mentor" | "staff">("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [viewing, setViewing] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState(0);
  const [removing, setRemoving] = useState<DashboardStudent | null>(null);
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const filtered = students.filter((s) => (type === "all" || s.memberType === type) && (!q || s.user.name.toLowerCase().includes(q) || s.user.email.toLowerCase().includes(q)));
  const shown = filtered.slice(0, limit);

  const view = (userId: string) => {
    setViewKey((k) => k + 1);
    setViewing(userId);
  };

  const confirmRemove = () => {
    if (!removing) return;
    const target = removing;
    startTransition(async () => {
      const res = await removeStudentAction(courseId, target.user.id);
      if (res.ok) {
        toast.success(res.message ?? "Student removed");
        setRemoving(null);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <section className="rounded-card border border-border bg-surface-1 shadow-card" aria-labelledby="students-title">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="students-title" className="text-lg font-semibold text-ink">
          Students <span className="text-sm font-normal text-ink-muted">({students.length})</span>
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="sm:w-36">
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Filter by member type">
              <option value="all">All members</option>
              <option value="student">Students</option>
              <option value="mentor">Mentors</option>
              <option value="staff">Staff</option>
            </Select>
          </div>
          <div className="sm:w-56">
            <Input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE_SIZE);
              }}
              placeholder="Search"
              aria-label="Search students"
              leftAddon={<Icon.Search className="size-4" />}
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-4">
          <EmptyState compact icon={<Icon.Search />} title="No students match your search" description="Try a different name or email, or change the member filter." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Progress</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Enrolled On</th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Last activity</th>
                <th className="px-4 py-2.5 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((s) => (
                <tr key={s.enrollmentId} className="transition-colors hover:bg-surface-2/60">
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => view(s.user.id)} className="flex min-w-0 items-center gap-3 text-left">
                      <Avatar name={s.user.name} src={s.user.avatarUrl} size="sm" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium text-ink hover:underline">{s.user.name}</span>
                          {s.memberType !== "student" && (
                            <Badge size="xs" tone="neutral">
                              {s.memberType}
                            </Badge>
                          )}
                          {s.certificateCode && (
                            <span title="Certificate issued" className="text-success">
                              <Icon.Certificate className="size-4" />
                              <span className="sr-only">Certificate issued</span>
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-ink-muted">{s.user.email}</span>
                      </span>
                    </button>
                  </td>
                  <td className="w-44 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ProgressBar value={s.progress} size="sm" tone={s.progress >= 100 ? "success" : "accent"} label={`${s.user.name} progress`} className="flex-1" />
                      <span className="w-9 text-right text-xs tabular-nums text-ink-muted">{s.progress}%</span>
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-ink-muted md:table-cell">{s.enrolledLabel}</td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-ink-muted lg:table-cell">{s.lastActivityLabel ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Dropdown
                      trigger={
                        <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
                          <Icon.MoreHorizontal className="size-4" />
                          <span className="sr-only">Actions for {s.user.name}</span>
                        </span>
                      }
                      items={[
                        { label: "View progress", icon: <Icon.BarChart />, onClick: () => view(s.user.id) },
                        { label: "View profile", icon: <Icon.User />, href: `/user/${s.user.username}` },
                        ...(s.certificateCode ? [{ label: "View certificate", icon: <Icon.Certificate />, href: `/certificates/${s.certificateCode}` }] : []),
                        { label: "Remove", icon: <Icon.Trash />, destructive: true, separator: true, onClick: () => setRemoving(s) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > shown.length && (
        <div className="flex items-center justify-center gap-3 border-t border-border px-4 py-3 text-sm text-ink-muted">
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            Load More
          </Button>
          <span className="tabular-nums">
            {shown.length} of {filtered.length}
          </span>
        </div>
      )}

      <StudentProgressDialog key={viewKey} courseId={courseId} userId={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={removing !== null}
        onClose={() => !pending && setRemoving(null)}
        onConfirm={confirmRemove}
        loading={pending}
        title="Remove this student?"
        description={removing ? `${removing.user.name} will be unenrolled and their lesson and video progress in this course deleted. Certificates already issued are kept. This action cannot be undone.` : undefined}
        confirmLabel="Remove"
        destructive
      />
    </section>
  );
}

/** Per-lesson completion with a sort toggle. */
export function LessonCompletionList({ stats }: { stats: LessonCompletionStat[] }) {
  const [sort, setSort] = useState<"index" | "rate">("index");
  const rows = [...stats].sort((a, b) => (sort === "index" ? a.order - b.order : b.percent - a.percent || a.order - b.order));
  return (
    <section className="rounded-card border border-border bg-surface-1 shadow-card" aria-labelledby="lesson-completion-title">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 id="lesson-completion-title" className="text-sm font-semibold text-ink">
          Lesson Completion
        </h2>
        <div className="w-40">
          <Select value={sort} onChange={(e) => setSort(e.target.value as "index" | "rate")} aria-label="Sort by">
            <option value="index">Lesson Index</option>
            <option value="rate">Completion Rate</option>
          </Select>
        </div>
      </div>
      <ul className="scrollbar-thin max-h-[40vh] divide-y divide-border overflow-y-auto">
        {rows.map((l) => (
          <li key={l.lessonId} className="px-4 py-2.5">
            <div className="flex items-center gap-3 text-sm">
              <span className="w-8 shrink-0 font-mono text-xs text-ink-faint">{l.index}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{l.title}</span>
              <span className={cn("shrink-0 text-xs font-medium tabular-nums", l.percent > 0 ? "text-ink" : "text-ink-faint")} title={`${l.completionCount} completed`}>
                {l.percent}%
              </span>
            </div>
            <ProgressBar value={l.percent} size="xs" className="mt-1.5 pl-11" label={`${l.title} completion`} />
          </li>
        ))}
      </ul>
    </section>
  );
}
