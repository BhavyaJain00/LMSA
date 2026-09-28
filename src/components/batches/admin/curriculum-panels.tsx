"use client";

import Link from "next/link";
import { useState } from "react";
import type { AssessmentType } from "@/lib/types";
import { addBatchAssessmentAction, addBatchCourseAction, moveBatchCourseAction, removeBatchAssessmentAction, removeBatchCourseAction } from "@/lib/actions/batches";
import { pluralize } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { assessmentTypeIcon, assessmentTypeLabel } from "../assessment-list";
import { useServerAction } from "../hooks";
import type { Option } from "../types";
import { GroupedSelect } from "./form-fields";

export interface AdminBatchCourse {
  id: string;
  title: string;
  slug: string;
  published: boolean;
  lessonCount: number;
  completedBy: number;
}

/** Ordered batch courses with reorder / remove, plus an "Add course" picker. */
export function CoursesPanel({ batchId, courses, options, studentCount }: { batchId: string; courses: AdminBatchCourse[]; options: Option[]; studentCount: number }) {
  const [courseId, setCourseId] = useState("");
  const [removing, setRemoving] = useState<AdminBatchCourse | null>(null);
  const add = useServerAction();
  const mutate = useServerAction();

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Courses</h2>
          <p className="text-sm text-ink-muted">Learners are enrolled in every course of the batch. The order here is the order they see.</p>
        </div>
        {courses.length === 0 ? (
          <EmptyState icon={<Icon.BookOpen />} title="No courses added to this batch" description="Add the courses that make up the curriculum of this batch." compact />
        ) : (
          <ol className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
            {courses.map((c, i) => (
              <li key={c.id} className="flex items-center gap-3 p-3 sm:p-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-ink-muted">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <Link href={`/courses/${c.slug}`} className="block truncate font-medium text-ink hover:text-accent">
                    {c.title}
                  </Link>
                  <p className="text-xs text-ink-muted">
                    {pluralize(c.lessonCount, "lesson")} · {c.completedBy}/{studentCount} completed
                    {!c.published && (
                      <Badge tone="warning" size="xs" className="ml-2">
                        Unpublished
                      </Badge>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconButton label="Move up" size="icon-sm" disabled={i === 0 || mutate.pending} onClick={() => mutate.run(() => moveBatchCourseAction(batchId, c.id, "up"))}>
                    <Icon.ChevronUp className="size-4" />
                  </IconButton>
                  <IconButton label="Move down" size="icon-sm" disabled={i === courses.length - 1 || mutate.pending} onClick={() => mutate.run(() => moveBatchCourseAction(batchId, c.id, "down"))}>
                    <Icon.ChevronDown className="size-4" />
                  </IconButton>
                  <IconButton label={`Remove ${c.title}`} size="icon-sm" onClick={() => setRemoving(c)} className="hover:text-danger">
                    <Icon.Trash className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader title="Add a course to the batch" />
        <CardBody className="space-y-3">
          <Field label="Course" htmlFor="add-course" hint={studentCount ? `The ${pluralize(studentCount, "enrolled student")} will be enrolled in it.` : undefined}>
            <GroupedSelect id="add-course" value={courseId} onChange={setCourseId} options={options} placeholder={options.length ? "Select a course" : "No more courses available"} disabled={!options.length} />
          </Field>
          <Button
            className="w-full"
            disabled={!courseId}
            loading={add.pending}
            leftIcon={<Icon.Plus className="size-4" />}
            onClick={() => add.run(() => addBatchCourseAction(batchId, courseId), { onSuccess: () => setCourseId("") })}
          >
            Add course
          </Button>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) mutate.run(() => removeBatchCourseAction(batchId, removing.id), { onSuccess: () => setRemoving(null) });
        }}
        loading={mutate.pending}
        destructive
        title={`Remove ${removing?.title ?? "course"} from this batch?`}
        description="The course will no longer be part of the batch curriculum. Learners keep their existing enrollment and progress in the course."
        confirmLabel="Remove"
      />
    </div>
  );
}

export interface AdminBatchAssessment {
  id: string;
  type: AssessmentType;
  title: string;
  href: string;
  courseTitle?: string;
  missing: boolean;
  passedBy: number;
}

/** Batch assessments with remove, plus "Add an assessment" (type → picker). */
export function AssessmentsPanel({
  batchId,
  assessments,
  options,
  studentCount,
}: {
  batchId: string;
  assessments: AdminBatchAssessment[];
  options: Record<AssessmentType, Option[]>;
  studentCount: number;
}) {
  const [type, setType] = useState<AssessmentType | "">("");
  const [refId, setRefId] = useState("");
  const [removing, setRemoving] = useState<AdminBatchAssessment | null>(null);
  const add = useServerAction();
  const remove = useServerAction();
  const typeOptions = type ? options[type] : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Assessments</h2>
          <p className="text-sm text-ink-muted">Quizzes, assignments and programming exercises learners complete as part of this batch.</p>
        </div>
        {assessments.length === 0 ? (
          <EmptyState icon={<Icon.ClipboardList />} title="No assessments added to this batch" description="Add quizzes, assignments or exercises to track the cohort's progress." compact />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
            {assessments.map((a) => (
              <li key={a.id} className="flex items-center gap-3 p-3 sm:p-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent [&>svg]:size-4" aria-hidden="true">
                  {assessmentTypeIcon[a.type]}
                </span>
                <div className="min-w-0 flex-1">
                  {a.missing ? (
                    <span className="block truncate font-medium text-ink-muted line-through">{a.title}</span>
                  ) : (
                    <Link href={a.href} className="block truncate font-medium text-ink hover:text-accent">
                      {a.title}
                    </Link>
                  )}
                  <p className="text-xs text-ink-muted">
                    {assessmentTypeLabel[a.type]}
                    {a.courseTitle && <> · {a.courseTitle}</>} · {a.passedBy}/{studentCount} passed
                  </p>
                </div>
                <IconButton label={`Remove ${a.title}`} size="icon-sm" onClick={() => setRemoving(a)} className="hover:text-danger">
                  <Icon.Trash className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader title="Add an assessment" />
        <CardBody className="space-y-3">
          <Field label="Type" htmlFor="assessment-type">
            <Select
              id="assessment-type"
              value={type}
              onChange={(e) => {
                setType(e.target.value as AssessmentType | "");
                setRefId("");
              }}
            >
              <option value="">Select a type</option>
              <option value="quiz">Quiz</option>
              <option value="assignment">Assignment</option>
              <option value="exercise">Programming Exercise</option>
            </Select>
          </Field>
          {type && (
            <Field label="Assessment" htmlFor="assessment-ref">
              <GroupedSelect
                id="assessment-ref"
                value={refId}
                onChange={setRefId}
                options={typeOptions}
                placeholder={typeOptions.length ? `Select a ${assessmentTypeLabel[type].toLowerCase()}` : "Nothing left to add"}
                disabled={!typeOptions.length}
              />
            </Field>
          )}
          <Button
            className="w-full"
            disabled={!type || !refId}
            loading={add.pending}
            leftIcon={<Icon.Plus className="size-4" />}
            onClick={() => type && add.run(() => addBatchAssessmentAction(batchId, type, refId), { onSuccess: () => setRefId("") })}
          >
            Add assessment
          </Button>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.run(() => removeBatchAssessmentAction(batchId, removing.id), { onSuccess: () => setRemoving(null) });
        }}
        loading={remove.pending}
        destructive
        title={`Remove ${removing?.title ?? "assessment"}?`}
        description="It will no longer be listed for this batch. Existing submissions are kept."
        confirmLabel="Remove"
      />
    </div>
  );
}
