"use client";

import { useActionState } from "react";
import { createQuizAction } from "@/lib/actions/quiz";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/input";
import type { CourseOption } from "./types";

export function NewQuizForm({ courses, defaultCourseId }: { courses: CourseOption[]; defaultCourseId?: string }) {
  const [state, action, pending] = useActionState(createQuizAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormError message={state && !state.ok && !Object.keys(errors).length ? state.error : null} />
      <Field label="Title" htmlFor="quiz-title" required error={errors.title} hint="Learners see this on the quiz card and in their results.">
        <Input id="quiz-title" name="title" required autoFocus maxLength={200} placeholder="e.g. Chapter 2 check-in" invalid={!!errors.title} />
      </Field>
      <Field
        label="Course"
        htmlFor="quiz-course"
        error={errors.courseId}
        hint="Optional. Quizzes embedded in a lesson are linked to that course automatically."
      >
        <Select id="quiz-course" name="courseId" defaultValue={defaultCourseId ?? ""} invalid={!!errors.courseId}>
          <option value="">No course</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Passing Percentage" htmlFor="quiz-passing" required error={errors.passingPercentage} hint="Learners pass when their score reaches this percentage.">
        <Input
          id="quiz-passing"
          name="passingPercentage"
          type="number"
          min={0}
          max={100}
          step="1"
          defaultValue={70}
          required
          rightAddon={<span className="text-sm">%</span>}
          invalid={!!errors.passingPercentage}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <ButtonLink href="/admin/quizzes" variant="outline">
          Cancel
        </ButtonLink>
        <Button type="submit" loading={pending}>
          Create quiz
        </Button>
      </div>
    </form>
  );
}
